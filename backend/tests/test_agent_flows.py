"""Router, streaming, and the propose -> review -> decide lifecycle (the paused run lives in Postgres)."""

import json

from app.agent.graph import AgentPlan, Decomposition, Patch, PlanOp, Route, Task, build_graph
from app.agent.llm import LLMError
from tests.test_api import create, plan, sec, skill_names


def add_skill(skills_id, name, level=3):
    return PlanOp(op="add_item", sectionId=skills_id, patch=Patch(name=name, level=level))


async def stream(client, rid, message, mode="apply"):
    async with client.stream("POST", f"/api/resumes/{rid}/chat/stream", json={"message": message, "mode": mode}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        return [json.loads(line[6:]) async for line in r.aiter_lines() if line.startswith("data: ")]


async def checkpoint_rows(infra, rid):
    async with infra._pool.connection() as conn:
        cur = await conn.execute("select count(*) as n from checkpoints where thread_id like %s", (f"chat:{rid}:%",))
        return (await cur.fetchone())["n"]


# ---------------------------------------------------------------- routing


async def test_questions_are_answered_without_planning_or_changing_anything(client, infra):
    doc = await create(client)
    infra.llm.routes.append(Route(intent="answer", reason="a question"))
    infra.llm.answers.append("Your profile is solid.")
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "is my profile ok?"})).json()
    assert out["reply"] == "Your profile is solid." and out["applied"] == [] and out["changes"] == []
    assert out["undoVersionId"] is None and out["resume"]["version"] == 1
    assert (infra.llm.route_calls, infra.llm.answer_calls, infra.llm.json_calls) == (1, 1, 0)  # the planner never ran
    assert infra.llm.fast_flags == [True]  # routing uses the cheap model
    assert [m["role"] for m in (await client.get(f"/api/resumes/{doc['id']}/chat")).json()] == ["user", "assistant"]
    assert (await client.get(f"/api/resumes/{doc['id']}/versions")).json() == []  # nothing to undo


async def test_edit_requests_take_the_planning_path(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff"))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "headline: Staff"})).json()
    assert out["applied"] and (infra.llm.route_calls, infra.llm.answer_calls, infra.llm.json_calls) == (1, 0, 1)


async def test_a_failing_router_falls_back_to_editing(client, infra):
    """Routing is an optimisation, never a point of failure: if the cheap model is down the message is treated as an edit."""
    doc = await create(client)
    infra.llm.routes.append(LLMError("lite model unavailable"))
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff"))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "headline: Staff"})).json()
    assert out["applied"] == ["Updated personal info (headline)"] and infra.llm.json_calls == 1


# ---------------------------------------------------------------- streaming


async def test_stream_reports_progress_then_the_result(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff"))))
    events = await stream(client, doc["id"], "headline: Staff")
    assert events[0] == {"type": "status", "label": "Understanding your request…"}
    assert [e["node"] for e in events if e["type"] == "step"] == ["route", "decompose", "plan", "apply"]
    labels = [e["label"] for e in events if e["type"] == "status"]
    assert labels == ["Understanding your request…", "Planning the work…", "Planning the changes…", "Checking the changes…", "Saving…"]
    done = events[-1]
    assert done["type"] == "done" and done["result"]["applied"] == ["Updated personal info (headline)"]
    assert done["result"]["resume"]["version"] == 2


async def test_stream_shows_the_repair_loop(client, infra):
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    infra.llm.plans.append(plan("x", PlanOp(op="add_item", sectionId=skills, patch=Patch())))  # rejected: no content
    infra.llm.plans.append(plan("Added.", add_skill(skills, "Docker", 4)))
    events = await stream(client, doc["id"], "add docker")
    assert [e["node"] for e in events if e["type"] == "step"] == ["route", "decompose", "plan", "apply", "repair", "apply"]
    assert "Fixing 1 failed change…" in [e["label"] for e in events if e["type"] == "status"]
    assert events[-1]["result"]["applied"] == ["Added “Docker” to “Skills”"]


async def test_stream_reports_errors_as_events(client, infra):
    doc = await create(client)
    infra.llm.plans.append(LLMError("Gemini is overloaded", 429))
    events = await stream(client, doc["id"], "anything")
    assert events[-1] == {"type": "error", "status": 429, "message": "Gemini is overloaded"}


async def test_stream_of_an_unknown_cv_is_a_normal_404(client):
    r = await client.post("/api/resumes/00000000-0000-0000-0000-000000000000/chat/stream", json={"message": "hi"})
    assert r.status_code == 404


# ---------------------------------------------------------------- propose / review / decide


async def propose(client, infra, doc, *names):
    skills = sec(doc, "Skills")["id"]
    infra.llm.plans.append(plan("Added the skills.", *[add_skill(skills, n) for n in names]))
    events = await stream(client, doc["id"], "add skills", mode="propose")
    return events, events[-1]


async def test_propose_mode_changes_nothing_until_you_decide(client, infra):
    doc = await create(client)
    events, proposal = await propose(client, infra, doc, "Rust", "Go")
    assert proposal["type"] == "proposal" and [e["type"] for e in events].count("done") == 0
    assert [i["summary"] for i in proposal["items"]] == ["Added “Rust” to “Skills”", "Added “Go” to “Skills”"]
    assert proposal["changes"] == ["Added “Rust” to “Skills”", "Added “Go” to “Skills”"] and proposal["reply"]
    stored = (await client.get(f"/api/resumes/{doc['id']}")).json()
    assert stored["version"] == 1 and not {"Rust", "Go"} & set(skill_names(stored))  # nothing saved
    assert await checkpoint_rows(infra, doc["id"]) > 0  # the paused run is stored in Postgres
    assert (await client.get(f"/api/resumes/{doc['id']}/chat")).json() == []  # and not in the conversation yet


async def test_accepting_only_some_changes_applies_only_those(client, infra):
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust", "Go")
    out = (await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": [1]})).json()
    assert out["applied"] == ["Added “Go” to “Skills”"] and out["reply"] == "Applied 1 of 2 proposed changes."
    names = skill_names(out["resume"])
    assert "Go" in names and "Rust" not in names and out["resume"]["version"] == 2
    assert out["undoVersionId"] and out["changes"] == ["Added “Go” to “Skills”"]
    hist = (await client.get(f"/api/resumes/{doc['id']}/chat")).json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[-1]["undoVersionId"] == out["undoVersionId"]
    assert await checkpoint_rows(infra, doc["id"]) == 0  # decided runs are cleaned up


async def test_accept_all(client, infra):
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust", "Go")
    out = (await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": "all"})).json()
    assert len(out["applied"]) == 2 and out["reply"] == "Added the skills." and {"Rust", "Go"} <= set(skill_names(out["resume"]))


async def test_rejecting_everything_leaves_the_cv_alone(client, infra):
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust")
    out = (await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": "none"})).json()
    assert out["applied"] == [] and out["undoVersionId"] is None and out["resume"]["version"] == 1
    assert "didn’t apply" in out["reply"]
    assert (await client.get(f"/api/resumes/{doc['id']}/versions")).json() == []  # nothing to undo


async def test_a_proposal_can_only_be_decided_once(client, infra):
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust")
    url = f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide"
    assert (await client.post(url, json={"accept": "all"})).status_code == 200
    assert (await client.post(url, json={"accept": "all"})).status_code == 410


async def test_a_proposal_cannot_be_decided_through_another_cv(client, infra):
    one, two = await create(client), await create(client)
    _, proposal = await propose(client, infra, one, "Rust")
    r = await client.post(f"/api/resumes/{two['id']}/chat/{proposal['runId']}/decide", json={"accept": "all"})
    assert r.status_code == 410
    assert "Rust" not in skill_names((await client.get(f"/api/resumes/{two['id']}")).json())


async def test_deciding_after_the_cv_changed_is_a_conflict(client, infra):
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust")
    await client.post(f"/api/resumes/{doc['id']}/ops", json={"ops": [{"op": "update_basics", "patch": {"headline": "Edited meanwhile"}}]})
    r = await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": "all"})
    assert r.status_code == 409
    got = (await client.get(f"/api/resumes/{doc['id']}")).json()
    assert "Rust" not in skill_names(got) and got["resume"]["basics"]["headline"] == "Edited meanwhile"


async def test_a_paused_run_survives_losing_the_in_memory_graph(client, infra):
    """The pause is stored in Postgres, not in the process: a brand-new compiled graph (as after a restart) can resume it."""
    doc = await create(client)
    _, proposal = await propose(client, infra, doc, "Rust")
    original = infra.graph_hitl
    infra.graph_hitl = build_graph(infra.llm, checkpointer=infra.checkpointer)
    try:
        out = (await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": "all"})).json()
    finally:
        infra.graph_hitl = original
    assert out["applied"] == ["Added “Rust” to “Skills”"]


async def test_propose_mode_with_nothing_to_change_just_finishes(client, infra):
    doc = await create(client)
    infra.llm.routes.append(Route(intent="answer"))
    infra.llm.answers.append("All good.")
    events = await stream(client, doc["id"], "is it ok?", mode="propose")
    assert events[-1]["type"] == "done" and events[-1]["result"]["reply"] == "All good."


async def test_invalid_decisions_are_rejected(client, infra):
    doc = await create(client)
    r = await client.post(f"/api/resumes/{doc['id']}/chat/abc/decide", json={"accept": "maybe"})
    assert r.status_code == 422


# ---------------------------------------------------------------- decomposition (big requests run as focused tasks)


async def test_big_requests_run_as_focused_tasks(client, infra):
    doc = await create(client)
    skills, hobbies = sec(doc, "Skills")["id"], sec(doc, "Hobbies")["id"]
    infra.llm.decompositions.append(Decomposition(summary="Added two skills and a headline.", tasks=[
        Task(instruction="Add Rust", sectionIds=[skills]), Task(instruction="Add Go", sectionIds=[skills]), Task(instruction="Set headline Staff"),
    ]))
    infra.llm.plans += [
        plan("a", add_skill(skills, "Rust")), plan("b", add_skill(skills, "Go")), plan("c", PlanOp(op="update_basics", patch=Patch(headline="Staff"))),
    ]
    events = await stream(client, doc["id"], "do three things")
    assert [e["node"] for e in events if e["type"] == "step"] == ["route", "decompose", "plan", "apply", "next", "plan", "apply", "next", "plan", "apply"]
    assert any("task 2 of 3" in e["label"] for e in events if e["type"] == "status")
    r = events[-1]["result"]
    assert len(r["applied"]) == 3 and r["reply"] == "Added two skills and a headline." and r["resume"]["version"] == 2  # ONE save, one undo
    assert {"Rust", "Go"} <= set(skill_names(r["resume"])) and hobbies


async def test_a_failing_task_is_reported_but_the_others_still_run(client, infra):
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    infra.llm.decompositions.append(Decomposition(summary="Did it.", tasks=[Task(instruction="x"), Task(instruction="y")]))
    bad = PlanOp(op="add_item", sectionId=skills, patch=Patch())  # rejected, and the repair attempts keep failing
    infra.llm.plans += [plan("1", bad), plan("1b", bad), plan("1c", bad), plan("2", add_skill(skills, "Go"))]
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "two things"})).json()
    assert out["applied"] == ["Added “Go” to “Skills”"] and len(out["skipped"]) == 1


async def test_hallucinated_ids_or_a_failing_decomposer_fall_back_to_one_task(client, infra):
    doc = await create(client)
    infra.llm.decompositions.append(Decomposition(tasks=[Task(instruction="a", sectionIds=["nope"]), Task(instruction="b")]))
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="One"))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "x"})).json()
    assert out["applied"] and infra.llm.json_calls == 1
    infra.llm.decompositions.append(LLMError("lite down"))
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Two"))))
    out = (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "y"})).json()
    assert out["applied"] and infra.llm.json_calls == 2


async def test_tasks_work_in_review_mode_too(client, infra):
    doc = await create(client)
    skills = sec(doc, "Skills")["id"]
    infra.llm.decompositions.append(Decomposition(summary="Added Rust and Go.", tasks=[Task(instruction="a"), Task(instruction="b")]))
    infra.llm.plans += [plan("a", add_skill(skills, "Rust")), plan("b", add_skill(skills, "Go"))]
    events = await stream(client, doc["id"], "two skills", mode="propose")
    proposal = events[-1]
    assert proposal["type"] == "proposal" and len(proposal["items"]) == 2 and proposal["reply"] == "Added Rust and Go."
    out = (await client.post(f"/api/resumes/{doc['id']}/chat/{proposal['runId']}/decide", json={"accept": [0]})).json()
    assert out["applied"] == ["Added “Rust” to “Skills”"]
