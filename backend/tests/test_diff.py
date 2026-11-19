from app.domain.catalog import sample_resume
from app.domain.diff import diff_resumes
from app.domain.models import EntriesSection, Entry, LevelsSection, Leveled
from app.domain.ops import Op, apply_ops


def sec(r, title):
    return next(s for s in r.sections if s.title == title)


def test_no_changes_means_no_lines():
    r = sample_resume()
    assert diff_resumes(r, r.model_copy(deep=True)) == []


def test_headline_layout_and_personal_info():
    a = sample_resume()
    b = a.model_copy(deep=True)
    b.basics.headline = "Staff Engineer"
    b.basics.email = "new@example.com"
    b.layoutId = "timeline"
    out = diff_resumes(a, b)
    assert "Layout: sidebar → timeline" in out
    assert any(line.startswith("Headline:") and "Staff Engineer" in line for line in out)
    assert "Personal info changed (email)" in out


def test_items_added_removed_edited_reordered():
    a = sample_resume()
    b = a.model_copy(deep=True)
    skills = sec(b, "Skills")
    assert isinstance(skills, LevelsSection)
    skills.items.append(Leveled(id="new", name="Docker", level=4))
    skills.items[0].level = 1  # edit
    skills.items.pop(1)  # remove
    emp = sec(b, "Employment History")
    assert isinstance(emp, EntriesSection)
    emp.items.reverse()
    out = diff_resumes(a, b)
    assert "Added “Docker” to “Skills”" in out
    assert any(l.startswith("Removed “React”") for l in out)
    assert any(l.startswith("Edited “TypeScript” in “Skills” (level)") for l in out)
    assert "Reordered the items in “Employment History”" in out


def test_sections_added_removed_renamed_moved_stashed_text_edited():
    a = sample_resume()
    b = a.model_copy(deep=True)
    sec(b, "Hobbies").zone = None
    sec(b, "Links").zone = "main"  # not accepted by the layout, but a diff only reports it
    profile = next(s for s in b.sections if s.id == sec(a, "Profile").id)
    profile.title = "About"
    profile.text = "New bio"
    b.sections = [s for s in b.sections if s.title != "Courses"]
    out = diff_resumes(a, b)
    assert "Removed “Hobbies” from the CV" in out
    assert "Moved “Links” to Main column" in out
    assert "Renamed section “Profile” → “About”" in out
    assert "Edited the text of “About”" in out
    assert "Deleted section “Courses”" in out


def test_section_order_only_when_nothing_else_moved():
    a = sample_resume()
    b = a.model_copy(deep=True)
    side = [s for s in b.sections if s.zone == "side"]
    others = [s for s in b.sections if s.zone != "side"]
    b.sections = list(reversed(side)) + others
    assert diff_resumes(a, b) == ["Reordered the sections"]


def test_diff_matches_what_ops_report():
    """The change list is derived from the documents, so it agrees with what the engine says it did."""
    a = sample_resume()
    skills = sec(a, "Skills")
    res = apply_ops(a, [Op(op="add_item", sectionId=skills.id, itemId="d", patch={"name": "Docker", "level": 4}), Op(op="update_basics", patch={"headline": "X"})])
    changes = diff_resumes(a, res.resume)
    assert len(res.applied) == 2
    assert "Added “Docker” to “Skills”" in changes
    assert any(l.startswith("Headline:") and "“X”" in l for l in changes)
    assert len(changes) == 2  # nothing else is reported
