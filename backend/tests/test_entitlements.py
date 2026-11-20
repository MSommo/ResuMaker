"""Per-user AI entitlement: who may use the AI features, and that every AI endpoint enforces it."""

import pytest

from tests.test_api import create


def _ai_requests(pid: str, rid: str):
    """(method, url, kwargs) for every AI endpoint. If a new one is added, add it here."""
    return [
        ("POST", f"/api/personas/{pid}/imports/cv", {"files": {"file": ("cv.pdf", b"%PDF-1.4 x")}}),
        ("POST", f"/api/personas/{pid}/memories", {"json": {"kind": "fact", "text": "Speaks Italian"}}),
        ("POST", "/api/ai/improve", {"json": {"kind": "summary", "text": "I do things."}}),
        ("POST", f"/api/resumes/{rid}/chat", {"json": {"message": "make it shorter"}}),
        ("POST", f"/api/resumes/{rid}/chat/stream", {"json": {"message": "make it shorter"}}),
        ("POST", f"/api/resumes/{rid}/tailor/stream", {"json": {"posting": "We are hiring a backend engineer. " * 3}}),
        ("POST", f"/api/resumes/{rid}/chat/some-run/decide", {"json": {"accept": "all"}}),
    ]


def test_the_list_above_covers_every_ai_endpoint():
    """Every route behind `require_ai` is in `_ai_requests`, so the tests below can't silently miss one."""
    from app.api import auth_routes, routes
    from app.api.deps import require_ai

    gated = {
        (m, "/api" + r.path)
        for router in (routes.router, routes.public, auth_routes.public, auth_routes.protected, auth_routes.admin)
        for r in router.routes
        if any(d.call is require_ai for d in r.dependant.dependencies)
        for m in r.methods
    }
    listed = {(m, u.replace("PID", "{persona_id}").replace("RID", "{resume_id}").replace("some-run", "{run_id}")) for m, u, _ in _ai_requests("PID", "RID")}
    assert gated == listed


async def _disable_ai(make_client, client):
    boss = await make_client(role="admin")
    r = await boss.patch(f"/api/admin/users/{client.user.id}", json={"aiEnabled": False})
    assert r.status_code == 200 and r.json()["aiEnabled"] is False
    return boss


async def test_new_and_existing_accounts_have_ai_by_default(client):
    assert (await client.get("/api/auth/me")).json()["ai"] is True


async def test_every_ai_endpoint_refuses_a_user_without_ai(client, make_client, infra):
    cv = await create(client)
    pid = (await client.get("/api/auth/me")).json()["persona"]["id"]
    await _disable_ai(make_client, client)
    assert (await client.get("/api/auth/me")).json()["ai"] is False
    for method, url, kw in _ai_requests(pid, cv["id"]):
        r = await client.request(method, url, **kw)
        assert r.status_code == 403, (url, r.status_code, r.text)
        assert "aren't included" in r.json()["error"]
    assert infra.llm.text_calls == [] and infra.llm.route_calls == 0 and infra.llm.embed_calls == 0  # nothing reached the model
    # Everything that isn't AI keeps working, including reading memories already saved.
    assert (await client.get(f"/api/resumes/{cv['id']}")).status_code == 200
    assert (await client.get(f"/api/personas/{pid}/memories")).status_code == 200


async def test_turning_ai_back_on_restores_access(client, make_client):
    boss = await _disable_ai(make_client, client)
    assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})).status_code == 403
    await boss.patch(f"/api/admin/users/{client.user.id}", json={"aiEnabled": True})
    assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})).status_code == 200


async def test_refused_requests_do_not_use_up_the_ai_quota(client, make_client, infra):
    boss = await _disable_ai(make_client, client)
    infra.settings.ai_rate_limit_per_min = 2
    for _ in range(5):
        assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "x"})).status_code == 403
    await boss.patch(f"/api/admin/users/{client.user.id}", json={"aiEnabled": True})
    assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "x"})).status_code == 200


async def test_administrators_always_have_ai(make_client):
    boss = await make_client(role="admin")
    other = await make_client(role="admin")
    await other.patch(f"/api/admin/users/{boss.user.id}", json={"aiEnabled": False})
    assert (await boss.get("/api/auth/me")).json()["ai"] is True
    assert (await boss.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})).status_code == 200


async def test_only_administrators_can_change_ai_access(client, make_client):
    other = await make_client()
    assert (await other.patch(f"/api/admin/users/{client.user.id}", json={"aiEnabled": False})).status_code == 403
    assert (await client.get("/api/auth/me")).json()["ai"] is True


async def test_without_a_configured_model_ai_is_not_configured_for_anyone(client, infra, monkeypatch):
    monkeypatch.setattr(infra, "llm", None)
    r = await client.post("/api/ai/improve", json={"kind": "summary", "text": "x"})
    assert r.status_code == 501


async def test_mcp_ai_tools_follow_the_entitlement(client, make_client, infra, monkeypatch):
    from app import mcp_server

    cv = await create(client)
    monkeypatch.setattr(mcp_server, "_infra", infra)
    monkeypatch.setattr(mcp_server, "_user_id", client.user.id)
    assert await mcp_server.improve_text_tool("I do things.", "summary")  # entitled: works
    await _disable_ai(make_client, client)  # takes effect on the running server, no restart
    for call in (
        mcp_server.improve_text_tool("I do things.", "summary"),
        mcp_server.ask_assistant(cv["id"], "hi"),
        mcp_server.propose_changes(cv["id"], "hi"),
        mcp_server.remember("I prefer short bullets"),
        mcp_server.tailor_to_posting(cv["id"], "We are hiring a backend engineer. " * 3),
        mcp_server.decide_proposal(cv["id"], "some-run"),
    ):
        with pytest.raises(ValueError, match="aren't included"):
            await call
    assert (await mcp_server.get_resume(cv["id"]))["layoutId"]  # non-AI tools still work


async def test_turning_ai_off_during_a_run_saves_nothing(client, make_client, infra, monkeypatch):
    """The gate runs when a request starts; a run takes a while. If AI is turned off meanwhile, its result isn't saved."""
    from app.agent.graph import Patch, PlanOp
    from app.services import chat
    from tests.test_agent_flows import stream
    from tests.test_api import plan

    doc = await create(client)
    boss = await make_client(role="admin")
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Staff"))))
    real = chat._drive

    async def run_then_turn_ai_off(*args, **kwargs):
        async for ev in real(*args, **kwargs):
            yield ev
        assert (await boss.patch(f"/api/admin/users/{client.user.id}", json={"aiEnabled": False})).status_code == 200

    monkeypatch.setattr(chat, "_drive", run_then_turn_ai_off)
    events = await stream(client, doc["id"], "headline: Staff")
    assert events[-1] == {"type": "error", "status": 403, "message": "AI features aren't included in your account."}
    got = (await client.get(f"/api/resumes/{doc['id']}")).json()
    assert got["version"] == doc["version"] and got["resume"]["basics"]["headline"] != "Staff"
    assert (await client.get(f"/api/resumes/{doc['id']}/chat")).json() == []  # nothing recorded either
