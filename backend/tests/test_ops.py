from app.domain.catalog import blank_resume, sample_resume
from app.domain.models import EntriesSection, LevelsSection
from app.domain.ops import Op, apply_ops


def sec(r, title):
    return next(s for s in r.sections if s.title == title)


def test_add_skill_and_original_is_untouched():
    r = sample_resume()
    skills = sec(r, "Skills")
    before = len(skills.items)
    res = apply_ops(r, [Op(op="add_item", sectionId=skills.id, itemId="n1", patch={"name": "Docker", "level": 4})])
    assert res.applied == ["Added “Docker” to “Skills”"] and not res.skipped
    new = sec(res.resume, "Skills").items[-1]
    assert (new.name, new.level) == ("Docker", 4)
    assert len(skills.items) == before  # input not mutated


def test_blank_items_are_refused():
    r = sample_resume()
    res = apply_ops(r, [Op(op="add_item", sectionId=sec(r, "Skills").id, patch={})])
    assert not res.applied and "no content" in res.skipped[0]
    assert res.failed[0][1] == "the new item had no content"


def test_new_ids_can_be_referenced_by_later_ops():
    r = blank_resume()
    res = apply_ops(r, [
        Op(op="add_section", sectionId="sec_x", template="custom-timeline", patch={"title": "Projects"}),
        Op(op="add_item", sectionId="sec_x", itemId="it_1", patch={"title": "ResuMaker", "start": "2024-01", "current": True}),
        Op(op="update_item", sectionId="sec_x", itemId="it_1", patch={"note": "Open source"}),
    ])
    assert len(res.applied) == 3 and not res.skipped
    projects = sec(res.resume, "Projects")
    assert isinstance(projects, EntriesSection) and projects.zone == "main"
    assert projects.items[0].note == "Open source" and projects.items[0].current


def test_basics_country_names_and_bad_dates():
    r = sample_resume()
    res = apply_ops(r, [Op(op="update_basics", patch={"country": "Italy", "birthDate": "19/03/1993", "headline": "Staff"})])
    assert res.resume.basics.address.country == "IT"
    assert res.resume.basics.birthDate == "1990-01-01"  # malformed date ignored
    assert res.resume.basics.headline == "Staff"


def test_entry_dates_must_be_iso_months():
    r = sample_resume()
    emp = sec(r, "Employment History")
    res = apply_ops(r, [Op(op="update_item", sectionId=emp.id, itemId=emp.items[0].id, patch={"start": "March 2024"})])
    assert res.skipped and res.skipped[0].startswith("update_item")


def test_zone_rules_and_move():
    r = sample_resume()
    skills, emp = sec(r, "Skills"), sec(r, "Employment History")
    bad = apply_ops(r, [Op(op="move_section", sectionId=emp.id, zone="side")])  # entries not accepted in the sidebar
    assert bad.skipped
    ok = apply_ops(r, [Op(op="move_section", sectionId=skills.id, zone="side", position=0)])
    side = [s.title for s in ok.resume.sections if s.zone == "side"]
    assert side[0] == "Skills"


def test_remove_section_stashes_and_keeps_content():
    r = sample_resume()
    skills = sec(r, "Skills")
    res = apply_ops(r, [Op(op="remove_section", sectionId=skills.id)])
    s = sec(res.resume, "Skills")
    assert s.zone is None and isinstance(s, LevelsSection) and len(s.items) == len(skills.items)


def test_one_bad_op_does_not_block_the_rest():
    r = sample_resume()
    res = apply_ops(r, [Op(op="nope"), Op(op="update_basics", patch={"headline": "X"}), Op(op="remove_item", sectionId="zzz", itemId="1")])
    assert res.applied == ["Updated personal info (headline)"] and len(res.skipped) == 2


def test_set_layout_and_unknown_layout():
    r = sample_resume()
    assert apply_ops(r, [Op(op="set_layout", layoutId="timeline")]).resume.layoutId == "timeline"
    assert apply_ops(r, [Op(op="set_layout", layoutId="nope")]).skipped
