"""AI usage per user (issue #25): every AI path leaves one metadata-only row, refusals included, and only admins can read them."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.agent.graph import Patch, PlanOp, Route
from app.agent.tailor import JobSpec
from app.db import AiUsageRow
from app.services import ai_usage
from tests.conftest import FAKE_TOKENS
from tests.test_agent_flows import add_skill, stream
from tests.test_api import create, plan, sec
from tests.test_entitlements import _disable_ai
from tests.test_import import cv_docx, good_cv, upload
from tests.test_memory import remember
from tests.test_tailor import POSTING, tailor

SECRET = "my very private chat message about Acme"


async def rows(infra, user_id) -> list[AiUsageRow]:
    await ai_usage.flush()  # rows are written in the background
    async with infra.session() as s:
        return list((await s.execute(select(AiUsageRow).where(AiUsageRow.user_id == user_id).order_by(AiUsageRow.created_at))).scalars())


def headline(text):
    return PlanOp(op="update_basics", patch=Patch(headline=text))


# ---------------------------------------------------------------- recording, per path


async def test_a_chat_turn_is_one_row_with_every_model_call_added_up(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", headline("Staff Engineer")))
    assert (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": SECRET})).status_code == 200
    [r] = await rows(infra, client.user.id)
    assert (r.feature, r.source, r.status, r.intent, str(r.resume_id)) == ("chat", "web", "ok", "edit", doc["id"])
    assert r.calls >= 2  # route + plan (+ the memory lookup's embedding)
    generate = sum(m["calls"] for name, m in r.models.items() if m["output"])
    assert r.output_tokens == FAKE_TOKENS[1] * generate and r.input_tokens == sum(m["input"] for m in r.models.values()) > 0
    assert r.ops_applied == 1 and r.ops_rejected == 0 and r.latency_ms >= 0 and r.request_id
    assert r.model and r.model in r.models


async def test_no_prompt_cv_or_chat_text_is_stored(client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", headline("Staff Engineer")))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": SECRET})
    [r] = await rows(infra, client.user.id)
    stored = " ".join(str(getattr(r, c.key)) for c in AiUsageRow.__table__.columns)
    assert "private" not in stored and "Staff Engineer" not in stored


async def test_streamed_chat_records_the_routers_own_verdict_for_off_topic(client, infra):
    doc = await create(client)
    infra.llm.routes.append(Route(intent="off_topic", reason="unrelated"))
    events = await stream(client, doc["id"], "write me a poem about the sea")
    assert events[-1]["type"] == "done"
    [r] = await rows(infra, client.user.id)
    assert r.intent == "off_topic" and r.status == "ok" and r.ops_applied == 0  # off_topic, not the "answer" it is folded into


async def test_contact_guard_rejections_and_repairs_are_counted(client, infra):
    doc = await create(client)
    infra.llm.plans += [plan("Done.", headline("Mail me at someone@not-in-the-cv.example")), plan("Sorry, I can't add that.")]
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "improve my headline"})
    [r] = await rows(infra, client.user.id)
    assert r.guard_rejections >= 1 and r.repairs == 1 and r.ops_applied == 0


@pytest.mark.parametrize("feature", ["improve", "memory", "import", "tailor"])
async def test_every_other_ai_path_is_recorded(feature, client, infra):
    doc = await create(client)
    if feature == "improve":
        assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})).status_code == 200
    elif feature == "memory":
        assert (await remember(client, doc["personaId"], "Prefers short bullets.")).status_code == 201
    elif feature == "import":
        infra.llm.imports.append(good_cv())
        assert (await upload(client, doc["personaId"], cv_docx())).status_code == 200
    else:
        infra.llm.specs.append(JobSpec(title="Backend Engineer", company="Acme", summary="Go.", keywords=["Go"], gaps=["Kubernetes"]))
        infra.llm.plans.append(plan("Tailored.", add_skill(sec(doc, "Skills")["id"], "Go")))
        assert (await tailor(client, doc["id"], POSTING))[-1]["type"] == "proposal"
    [r] = await rows(infra, client.user.id)  # tailoring runs a chat inside: still ONE row
    assert r.feature == feature and r.status == "ok" and r.calls >= 1
    if feature == "tailor":
        assert r.ops_applied == 1  # proposed


async def test_mcp_calls_are_recorded_as_such(client, infra, monkeypatch):
    from app import mcp_server

    monkeypatch.setattr(mcp_server, "_infra", infra)
    monkeypatch.setattr(mcp_server, "_user_id", client.user.id)
    await mcp_server.improve_text_tool("I do things.", "summary")
    [r] = await rows(infra, client.user.id)
    assert (r.feature, r.source, r.status) == ("improve", "mcp", "ok")


async def test_failures_are_recorded_with_a_reason(client, infra):
    from app.agent.llm import LLMError

    doc = await create(client)
    infra.llm.plans.append(LLMError("The AI request failed. Please try again."))
    assert (await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "hi"})).status_code == 502
    [r] = await rows(infra, client.user.id)
    assert (r.status, r.reason) == ("error", "llm_error")


# ---------------------------------------------------------------- refusals


async def test_refusals_are_recorded(client, make_client, infra):
    infra.settings.ai_rate_limit_per_min = 1
    try:
        assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "one"})).status_code == 200
        assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "two"})).status_code == 429
    finally:
        infra.settings.ai_rate_limit_per_min = 1000
    await _disable_ai(make_client, client)
    assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "three"})).status_code == 403
    got = [(r.feature, r.status, r.reason) for r in await rows(infra, client.user.id)]
    assert got == [("improve", "ok", None), ("improve", "rejected", "rate_limit"), ("improve", "rejected", "not_entitled")]


async def test_the_daily_limit_refusal_is_recorded(client, infra):
    infra.settings.ai_daily_limit = 1
    try:
        await client.post("/api/ai/improve", json={"kind": "summary", "text": "one"})
        assert (await client.post("/api/ai/improve", json={"kind": "summary", "text": "two"})).status_code == 429
    finally:
        infra.settings.ai_daily_limit = 300
    assert [r.reason for r in await rows(infra, client.user.id)] == [None, "daily_limit"]


async def test_a_client_hammering_a_limit_does_not_flood_the_table(client, infra):
    infra.settings.ai_rate_limit_per_min = 0
    try:
        for _ in range(ai_usage.MAX_REJECTION_ROWS_PER_MIN + 5):
            await client.post("/api/ai/improve", json={"kind": "summary", "text": "x"})
    finally:
        infra.settings.ai_rate_limit_per_min = 1000
    assert len(await rows(infra, client.user.id)) == ai_usage.MAX_REJECTION_ROWS_PER_MIN


# ---------------------------------------------------------------- reading: admins only


async def test_admins_see_usage_in_the_users_list_within_seconds(client, make_client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", headline("Staff Engineer")))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "hi"})
    await ai_usage.flush()
    boss = await make_client(role="admin")
    me = next(u for u in (await boss.get("/api/admin/users")).json() if u["id"] == str(client.user.id))
    u = me["aiUsage"]
    assert (u["today"], u["week"], u["month"], u["rejected"]) == (1, 1, 1, 0)
    assert u["tokens"] > 0 and u["costUsd"] >= 0 and u["lastUsedAt"] and u["dailyLimit"] == infra.settings.ai_daily_limit
    assert u["offTopicShare"] == 0.0


async def test_the_usage_detail_breaks_it_down(client, make_client, infra):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", headline("Staff Engineer")))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "hi"})
    await client.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})
    await ai_usage.flush()
    boss = await make_client(role="admin")
    d = (await boss.get(f"/api/admin/users/{client.user.id}/ai-usage")).json()
    assert sum(day["requests"] for day in d["series"]) == 2
    assert {f["feature"] for f in d["byFeature"]} == {"chat", "improve"}
    assert d["byModel"] and all(m["calls"] > 0 for m in d["byModel"])
    assert [r["feature"] for r in d["recent"]] == ["improve", "chat"]  # newest first
    assert set(d["recent"][0]) >= {"status", "intent", "inputTokens", "latencyMs", "requestId"} and "message" not in d["recent"][0]


async def test_the_usage_detail_checks_its_range(make_client):
    boss = await make_client(role="admin")
    base = f"/api/admin/users/{boss.user.id}/ai-usage"
    assert (await boss.get(base, params={"from": "2026-02-01T00:00:00Z", "to": "2026-01-01T00:00:00Z"})).status_code == 422
    assert (await boss.get(base, params={"from": "2025-01-01T00:00:00Z", "to": "2026-01-01T00:00:00Z"})).status_code == 422
    assert (await boss.get(f"/api/admin/users/{uuid.uuid4()}/ai-usage")).status_code == 404


async def test_people_cannot_read_usage_not_even_their_own(client, anon):
    assert (await client.get(f"/api/admin/users/{client.user.id}/ai-usage")).status_code == 403
    assert (await anon.get(f"/api/admin/users/{client.user.id}/ai-usage")).status_code == 401
    assert all("aiUsage" not in v for v in [(await client.get("/api/auth/me")).json()])


# ---------------------------------------------------------------- retention


async def test_rows_past_the_retention_period_are_deleted(client, infra):
    await client.post("/api/ai/improve", json={"kind": "summary", "text": "I do things."})
    await client.post("/api/ai/improve", json={"kind": "summary", "text": "Other things."})
    old, new = await rows(infra, client.user.id)
    async with infra.session() as s:
        await s.execute(update(AiUsageRow).where(AiUsageRow.id == old.id).values(created_at=datetime.now(timezone.utc) - timedelta(days=infra.settings.ai_usage_retention_days + 1)))
        await s.commit()
        assert await ai_usage.purge(s, infra.settings) >= 1
    assert [r.id for r in await rows(infra, client.user.id)] == [new.id]
