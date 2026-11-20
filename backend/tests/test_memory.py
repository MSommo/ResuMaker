"""Per-person memory: explicit, visible, scoped to the person, and never a source of truth."""

from app.agent.graph import Memo, Patch, PlanOp, Route
from app.agent.llm import LLMError
from tests.test_api import create, plan, sec

PREF = "Prefers bullets under twelve words."
FACT = "Was Staff Engineer at Acme from 2021."


async def remember(client, persona_id, text, kind="preference"):
    return await client.post(f"/api/personas/{persona_id}/memories", json={"kind": kind, "text": text})


async def memories(client, persona_id):
    return (await client.get(f"/api/personas/{persona_id}/memories")).json()


# ---------------------------------------------------------------- the memory API


async def test_add_list_and_delete(client):
    doc = await create(client)
    pid = doc["personaId"]
    assert await memories(client, pid) == []
    r = await remember(client, pid, PREF)
    assert r.status_code == 201 and r.json()["kind"] == "preference" and r.json()["text"] == PREF
    await remember(client, pid, FACT, "fact")
    listed = await memories(client, pid)
    assert [m["kind"] for m in listed] == ["fact", "preference"]  # newest first
    assert (await client.delete(f"/api/memories/{r.json()['id']}")).status_code == 204
    assert [m["text"] for m in await memories(client, pid)] == [FACT]
    assert (await client.delete(f"/api/memories/{r.json()['id']}")).status_code == 404


async def test_saying_the_same_thing_twice_keeps_one_memory(client):
    pid = (await create(client))["personaId"]
    first = (await remember(client, pid, PREF)).json()
    again = (await remember(client, pid, "  Prefers bullets   under twelve words. ")).json()
    assert again["id"] == first["id"] and len(await memories(client, pid)) == 1


async def test_validation(client):
    pid = (await create(client))["personaId"]
    assert (await remember(client, pid, "")).status_code == 422
    assert (await remember(client, pid, "x" * 301)).status_code == 422
    assert (await remember(client, pid, "ok", "opinion")).status_code == 422


async def test_memory_belongs_to_the_person_and_nobody_else_can_touch_it(client, make_client):
    a = (await create(client))["personaId"]
    saved = (await remember(client, a, PREF)).json()
    other = await make_client()
    assert (await remember(other, a, "mine now")).status_code == 404  # someone else's persona: not found
    assert (await other.get(f"/api/personas/{a}/memories")).status_code == 404
    assert (await other.delete(f"/api/memories/{saved['id']}")).status_code == 404
    assert [m["text"] for m in await memories(client, a)] == [PREF]  # untouched


# ---------------------------------------------------------------- "remember that…" in the chat


async def test_asking_the_assistant_to_remember_saves_a_memory_and_changes_nothing(client, infra):
    doc = await create(client)
    infra.llm.routes.append(Route(intent="remember"))
    infra.llm.memos.append(Memo(kind="preference", text=PREF))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "remember that I like short bullets"})).json()
    assert out["reply"] == f"Okay, I’ll remember: {PREF}" and out["intent"] == "remember"
    assert out["applied"] == [] and out["undoVersionId"] is None and out["resume"]["version"] == 1
    assert [m["text"] for m in await memories(client, doc["personaId"])] == [PREF]
    assert infra.llm.json_calls == 0  # the planner never ran

    infra.llm.routes.append(Route(intent="remember"))
    infra.llm.memos.append(Memo(kind="preference", text=PREF))
    again = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "remember short bullets"})).json()
    assert again["reply"] == f"I already had that: {PREF}" and len(await memories(client, doc["personaId"])) == 1


async def test_a_vague_request_to_remember_saves_nothing(client, infra):
    doc = await create(client)
    infra.llm.routes.append(Route(intent="remember"))
    infra.llm.memos.append(Memo(ok=False, reason="What should I remember?"))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "remember"})).json()
    assert out["reply"] == "What should I remember?" and await memories(client, doc["personaId"]) == []


async def test_remember_also_works_in_review_mode_without_asking_twice(client, infra):
    """Asking to remember is the consent: there is no CV change to review."""
    doc = await create(client)
    infra.llm.routes.append(Route(intent="remember"))
    infra.llm.memos.append(Memo(kind="fact", text=FACT))
    async with client.stream("POST", f"/api/resumes/{doc['id']}/chat/stream", json={"message": "note that I was Staff at Acme", "mode": "propose"}) as r:
        body = "".join([line async for line in r.aiter_lines()])
    assert '"type": "done"' in body and "proposal" not in body
    assert [m["kind"] for m in await memories(client, doc["personaId"])] == ["fact"]


# ---------------------------------------------------------------- memory reaches the writers


async def test_preferences_and_relevant_facts_reach_the_writers_and_unrelated_ones_do_not(client, infra):
    doc = await create(client)
    pid = doc["personaId"]
    await remember(client, pid, PREF)
    await remember(client, pid, "Was Staff Engineer at Acme from 2021 working on payments.", "fact")
    await remember(client, pid, "Allergic to peanuts and keeps bees.", "fact")  # nothing to do with the request below
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff Engineer"))))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "Update my headline: Staff Engineer at Acme from 2021 working on payments"})
    seen = " ".join(infra.llm.seen)
    assert "MEMORY" in seen and PREF in seen  # preferences always apply
    assert "Staff Engineer at Acme from 2021" in seen  # the related fact is included
    assert "peanuts" not in seen  # the unrelated fact is not


async def test_one_persons_memory_never_reaches_another_persons_cv(client, make_client, infra):
    other = await make_client()
    a, b = await create(client), await create(other)
    await remember(client, a["personaId"], PREF)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Lead"))))
    await other.post(f"/api/resumes/{b['id']}/chat", json={"message": "headline Lead"})
    assert PREF not in " ".join(infra.llm.seen) and "MEMORY" not in " ".join(infra.llm.seen)


async def test_without_memories_the_prompt_is_unchanged(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Lead"))))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "headline Lead"})
    assert "MEMORY" not in " ".join(infra.llm.seen)


async def test_if_memory_lookup_fails_the_assistant_still_works(client, infra, monkeypatch):
    doc = await create(client)
    await remember(client, doc["personaId"], FACT, "fact")

    async def boom(texts, *, query=False):
        raise LLMError("embeddings down")

    monkeypatch.setattr(infra.llm, "embed", boom)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Lead"))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "headline Lead"})).json()
    assert out["applied"] and "MEMORY" not in " ".join(infra.llm.seen)


async def test_the_cv_stays_the_source_of_truth(client, infra):
    """A remembered fact is only context: the prompt tells the model to trust the CV when they conflict."""
    from app.agent.prompts import CHAT_SYSTEM

    assert "source of truth" in CHAT_SYSTEM and "trust the CV" in CHAT_SYSTEM and "Never add a remembered fact" in CHAT_SYSTEM
