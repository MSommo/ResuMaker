import json

from app.agent.graph import AgentPlan, PlanOp, Patch
from tests.conftest import HEADERS


async def new_persona(client, first="Jane", last="Doe", **extra):
    r = await client.post("/api/personas", json={"firstName": first, "lastName": last, **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def create(client, template="sample", layout="sidebar", persona=None):
    persona = persona or await new_persona(client)
    r = await client.post(f"/api/personas/{persona['id']}/resumes", json={"template": template, "layoutId": layout})
    assert r.status_code == 201, r.text
    return r.json()


def sec(doc, title):
    return next(s for s in doc["resume"]["sections"] if s["title"] == title)


async def test_status(client):
    r = await client.get("/api/status")
    assert r.json() == {"ai": True, "pdf": True, "db": True, "cache": True}


async def test_unsafe_methods_require_the_app_header(client):
    r = await client.post("/api/personas", json={"firstName": "X"}, headers={"x-resumaker": "0"})
    assert r.status_code == 403


async def test_persona_crud_and_validation(client):
    p = await new_persona(client, "Ada", "Lovelace", email="ada@example.com", address={"city": "London", "country": "GB"})
    assert p["resumeCount"] == 0 and p["address"]["city"] == "London"
    assert any(x["id"] == p["id"] for x in (await client.get("/api/personas")).json())
    upd = await client.put(f"/api/personas/{p['id']}", json={"firstName": "Ada", "lastName": "King", "email": "a@k.org"})
    assert upd.json()["lastName"] == "King" and upd.json()["email"] == "a@k.org"
    assert (await client.post("/api/personas", json={"firstName": ""})).status_code == 422  # a name is required
    assert (await client.get("/api/personas/00000000-0000-0000-0000-000000000000")).status_code == 404
    assert (await client.delete(f"/api/personas/{p['id']}")).status_code == 204
    assert (await client.get(f"/api/personas/{p['id']}")).status_code == 404


async def test_a_persona_has_many_resumes(client):
    p = await new_persona(client, "Mario", "M")
    a = await create(client, "blank", "sidebar", p)
    b = await create(client, "sample", "timeline", p)
    detail = (await client.get(f"/api/personas/{p['id']}")).json()
    assert detail["persona"]["resumeCount"] == 2
    assert {r["id"] for r in detail["resumes"]} == {a["id"], b["id"]}
    assert all(r["personaId"] == p["id"] for r in detail["resumes"])
    # Templates never bring their own identity: the sample "Jane Doe" is replaced by the persona's details.
    assert b["resume"]["basics"]["firstName"] == "Mario" and b["resume"]["basics"]["lastName"] == "M"


async def test_personal_details_are_shared_by_all_of_a_personas_cvs(client):
    p = await new_persona(client, "Sam", "Shared")
    one, two = await create(client, "blank", persona=p), await create(client, "blank", layout="timeline", persona=p)
    r = await client.post(f"/api/resumes/{one['id']}/ops", json={"ops": [{"op": "update_basics", "patch": {"email": "sam@new.org", "headline": "Only on CV one"}}]})
    assert r.json()["resume"]["resume"]["basics"]["email"] == "sam@new.org"
    other = (await client.get(f"/api/resumes/{two['id']}")).json()["resume"]["basics"]
    assert other["email"] == "sam@new.org"  # personal detail: shared
    assert other["headline"] == ""  # headline: per CV
    assert (await client.get(f"/api/personas/{p['id']}")).json()["persona"]["email"] == "sam@new.org"


async def test_editing_the_persona_updates_every_cv(client):
    p = await new_persona(client, "Pat", "Before")
    doc = await create(client, "blank", persona=p)
    await client.put(f"/api/personas/{p['id']}", json={"firstName": "Pat", "lastName": "After"})
    got = (await client.get(f"/api/resumes/{doc['id']}")).json()
    assert got["resume"]["basics"]["lastName"] == "After"


async def test_cv_save_ignores_personal_details_but_keeps_the_headline(client):
    """The editor saves identity through the persona endpoint; a stale CV save must not overwrite it."""
    p = await new_persona(client, "Lee", "Real")
    doc = await create(client, "blank", persona=p)
    stale = doc["resume"]
    stale["basics"].update(firstName="Stale", lastName="Stale", headline="Staff Engineer")
    saved = (await client.put(f"/api/resumes/{doc['id']}", json={"resume": stale, "version": doc["version"]})).json()
    assert saved["resume"]["basics"]["firstName"] == "Lee"  # persona untouched
    assert saved["resume"]["basics"]["headline"] == "Staff Engineer" and saved["title"] == "Staff Engineer"


async def test_deleting_a_persona_deletes_their_cvs_but_not_others(client):
    gone, kept = await new_persona(client, "Gone", "X"), await new_persona(client, "Kept", "Y")
    doomed, safe = await create(client, "blank", persona=gone), await create(client, "blank", persona=kept)
    await client.delete(f"/api/personas/{gone['id']}")
    assert (await client.get(f"/api/resumes/{doomed['id']}")).status_code == 404
    assert (await client.get(f"/api/resumes/{safe['id']}")).status_code == 200


async def test_crud_roundtrip(client):
    doc = await create(client)
    assert doc["persona"]["firstName"] == "Jane" and doc["version"] == 1
    got = (await client.get(f"/api/resumes/{doc['id']}")).json()
    assert got["resume"] == doc["resume"]
    assert (await client.delete(f"/api/resumes/{doc['id']}")).status_code == 204
    assert (await client.get(f"/api/resumes/{doc['id']}")).status_code == 404


async def test_optimistic_locking(client):
    doc = await create(client)
    body = {"resume": doc["resume"], "version": doc["version"]}
    ok = await client.put(f"/api/resumes/{doc['id']}", json=body)
    assert ok.status_code == 200 and ok.json()["version"] == 2
    stale = await client.put(f"/api/resumes/{doc['id']}", json=body)  # still says version 1
    assert stale.status_code == 409 and stale.json()["current"]["version"] == 2


async def test_save_validates_the_document(client):
    doc = await create(client)
    r = await client.put(f"/api/resumes/{doc['id']}", json={"resume": {"sections": [{"kind": "nope"}]}})
    assert r.status_code == 422 and "error" in r.json()


async def test_ops_endpoint_applies_and_reports_skips(client):
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    r = await client.post(f"/api/resumes/{doc['id']}/ops", json={"ops": [
        {"op": "add_item", "sectionId": skills, "patch": {"name": "Rust", "level": 3}},
        {"op": "add_item", "sectionId": skills, "patch": {}},
    ]})
    out = r.json()
    assert len(out["applied"]) == 1 and len(out["skipped"]) == 1 and out["resume"]["version"] == 2


async def test_improve_is_cached_in_redis(client, infra):
    body = {"kind": "bullet", "text": "did stuff", "context": {"role": "Dev"}}
    first = (await client.post("/api/ai/improve", json=body)).json()
    second = (await client.post("/api/ai/improve", json=body)).json()
    assert first == {"text": "Improved text.", "cached": False}
    assert second == {"text": "Improved text.", "cached": True}
    assert len(infra.llm.text_calls) == 1  # Gemini was only asked once
    other = (await client.post("/api/ai/improve", json={**body, "instruction": "shorter"})).json()
    assert other["cached"] is False and len(infra.llm.text_calls) == 2


async def test_ai_rate_limit(client, infra):
    infra.settings.ai_rate_limit_per_min = 2
    codes = [(await client.post("/api/ai/improve", json={"text": f"t{i}"})).status_code for i in range(4)]
    assert codes == [200, 200, 429, 429]


def plan(reply, *ops):
    return AgentPlan(reply=reply, ops=list(ops))


async def test_chat_agent_edits_and_persists(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff Engineer"))))
    r = await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "set my headline"})
    out = r.json()
    assert out["applied"] == ["Updated personal info (headline)"] and out["resume"]["version"] == 2
    assert (await client.get(f"/api/resumes/{doc['id']}")).json()["resume"]["basics"]["headline"] == "Staff Engineer"
    hist = (await client.get(f"/api/resumes/{doc['id']}/chat")).json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["applied"]


async def test_chat_agent_repairs_failed_operations(client, infra):
    """The model first proposes an op that fails; the graph shows it the error and applies the corrected op."""
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    infra.llm.plans.append(plan("Added.", PlanOp(op="add_item", sectionId=skills, patch=Patch())))  # empty patch → rejected
    infra.llm.plans.append(plan("Added Docker.", PlanOp(op="add_item", sectionId=skills, patch=Patch(name="Docker", level=4))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "add docker 4"})).json()
    assert infra.llm.json_calls == 2
    assert out["applied"] == ["Added “Docker” to “Skills”"] and out["skipped"] == []
    assert out["reply"] == "Added Docker."


async def test_chat_gives_up_after_max_repairs_and_reports_failures(client, infra):
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    for _ in range(3):  # initial + 2 repairs, all still wrong
        infra.llm.plans.append(plan("Trying.", PlanOp(op="add_item", sectionId=skills, patch=Patch())))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "add something"})).json()
    assert infra.llm.json_calls == 3 and out["applied"] == [] and len(out["skipped"]) == 1
    assert out["resume"]["version"] == 1  # nothing was saved


async def test_chat_question_only_makes_no_changes(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Your profile is solid."))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "how is my profile?"})).json()
    assert out["applied"] == [] and out["resume"]["version"] == 1 and out["reply"] == "Your profile is solid."


async def test_clear_chat_history(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Hi."))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "hello"})
    assert len((await client.get(f"/api/resumes/{doc['id']}/chat")).json()) == 2
    await client.delete(f"/api/resumes/{doc['id']}/chat")
    assert (await client.get(f"/api/resumes/{doc['id']}/chat")).json() == []


async def test_pdf_is_cached_until_the_cv_changes(client, infra):
    doc = await create(client)
    a = await client.post(f"/api/resumes/{doc['id']}/pdf")
    b = await client.post(f"/api/resumes/{doc['id']}/pdf")
    assert a.headers["x-cache"] == "miss" and b.headers["x-cache"] == "hit" and infra.pdf.renders == 1
    assert a.content.startswith(b"%PDF") and f"/preview/{doc['id']}".encode() in a.content
    await client.post(f"/api/resumes/{doc['id']}/ops", json={"ops": [{"op": "update_basics", "patch": {"headline": "Changed"}}]})
    c = await client.post(f"/api/resumes/{doc['id']}/pdf")
    assert c.headers["x-cache"] == "miss" and infra.pdf.renders == 2


async def test_agent_graph_endpoint_formats(client):
    ascii_ = await client.get("/api/agent/graph")
    assert ascii_.status_code == 200 and ascii_.headers["content-type"].startswith("text/plain")
    assert all(n in ascii_.text for n in ("plan", "apply", "repair"))

    mermaid = (await client.get("/api/agent/graph?format=mermaid")).text
    assert "graph TD" in mermaid and "apply -.-> repair" in mermaid

    j = (await client.get("/api/agent/graph?format=json")).json()
    assert {n["id"] for n in j["nodes"]} == {"__start__", "plan", "apply", "repair", "__end__"}
    edges = {(e["source"], e["target"], e["conditional"]) for e in j["edges"]}
    assert ("repair", "apply", False) in edges and ("apply", "repair", True) in edges
    assert next(n for n in j["nodes"] if n["id"] == "repair")["description"]

    h = await client.get("/api/agent/graph?format=html")
    assert h.headers["content-type"].startswith("text/html") and 'class="mermaid"' in h.text

    assert (await client.get("/api/agent/graph?format=png")).status_code == 422
