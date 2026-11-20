"""Telemetry (issue #24): request ids, metrics behind a token, browser errors through the API, and scrubbed error reports."""

import json
import logging
import re

import pytest

from app.agent.graph import Patch, PlanOp
from app.observability import errors
from app.observability.logs import JsonFormatter, RequestIdFilter
from app.services import ai_usage
from tests.test_api import create, plan

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@pytest.fixture
def token(infra):
    infra.settings.metrics_token = "scrape-me"
    yield {"Authorization": "Bearer scrape-me"}
    infra.settings.metrics_token = ""


# ---------------------------------------------------------------- request ids and logs


async def test_every_response_carries_a_request_id_and_a_sane_incoming_one_is_kept(anon):
    rid = (await anon.get("/api/status")).headers["x-request-id"]
    assert re.fullmatch(r"[0-9a-f]{32}", rid)
    assert (await anon.get("/api/status", headers={"X-Request-ID": "nginx-abc12345"})).headers["x-request-id"] == "nginx-abc12345"
    odd = (await anon.get("/api/status", headers={"X-Request-ID": "<script>alert(1)</script>"})).headers["x-request-id"]
    assert odd != "<script>alert(1)</script>" and re.fullmatch(r"[0-9a-f]{32}", odd)


def test_json_log_lines_carry_the_request_id():
    from app.observability.context import reset_request_id, set_request_id

    record = logging.LogRecord("resumaker.test", logging.WARNING, __file__, 1, "something %s", ("happened",), None)
    t = set_request_id("req-12345678")
    try:
        RequestIdFilter().filter(record)
    finally:
        reset_request_id(t)
    line = json.loads(JsonFormatter().format(record))
    assert line["msg"] == "something happened" and line["request_id"] == "req-12345678" and line["level"] == "warning"


# ---------------------------------------------------------------- metrics


async def test_metrics_need_their_token_and_are_off_without_one(anon, token):
    assert (await anon.get("/api/metrics", headers={"Authorization": "Bearer nope"})).status_code == 401
    assert (await anon.get("/api/metrics")).status_code == 401
    assert (await anon.get("/api/metrics", headers=token)).status_code == 200


async def test_metrics_are_a_404_when_no_token_is_configured(anon):
    assert (await anon.get("/api/metrics", headers={"Authorization": "Bearer "})).status_code == 404


async def test_metrics_cover_http_ai_and_dependencies_without_ids(client, anon, infra, token):
    doc = await create(client)
    infra.llm.plans.append(plan("Done.", PlanOp(op="update_basics", patch=Patch(headline="Lead"))))
    await client.post(f"/api/resumes/{doc['id']}/chat", json={"message": "hi"})
    await ai_usage.flush()
    body = (await anon.get("/api/metrics", headers=token)).text
    assert 'route="/api/resumes/{resume_id}/chat"' in body  # the template, not the CV's id
    assert re.search(r'resumaker_ai_calls_total\{.*node="route".*\}', body) and re.search(r'resumaker_ai_calls_total\{.*node="plan".*\}', body)
    assert 'resumaker_ai_requests_total{feature="chat",intent="edit",source="web",status="ok"}' in body
    assert 'resumaker_up{component="db"} 1.0' in body and "resumaker_ai_tokens_total" in body
    assert not UUID.search(body)  # no user, CV or session ids anywhere


async def test_refusals_show_up_by_reason(client, anon, infra, token):
    infra.settings.ai_rate_limit_per_min = 0
    try:
        await client.post("/api/ai/improve", json={"kind": "summary", "text": "x"})
    finally:
        infra.settings.ai_rate_limit_per_min = 1000
    await ai_usage.flush()
    assert re.search(r'resumaker_rejected_total\{reason="rate_limit"\} [1-9]', (await anon.get("/api/metrics", headers=token)).text)


# ---------------------------------------------------------------- browser errors


async def test_browser_errors_go_through_the_api_redacted(client, anon, caplog):
    report = {"message": "x is undefined near jane@example.com +39 333 123 4567", "stack": "at f (app.js:1:2)", "path": "/editor/abc?q=secret"}
    assert (await anon.post("/api/telemetry/client-errors", json=report)).status_code == 401  # signed-in users only
    with caplog.at_level(logging.WARNING, logger="resumaker.api"):
        assert (await client.post("/api/telemetry/client-errors", json=report)).status_code == 204
    logged = " ".join(r.getMessage() for r in caplog.records if r.name == "resumaker.api")
    assert "browser error on /editor/abc:" in logged and "<email>" in logged and "<number>" in logged
    assert "jane@" not in logged and "secret" not in logged


async def test_an_error_loop_in_one_tab_cannot_flood_the_logs(client, caplog):
    from app.api.routes import CLIENT_ERRORS_PER_MIN

    with caplog.at_level(logging.WARNING, logger="resumaker.api"):
        for _ in range(CLIENT_ERRORS_PER_MIN + 5):
            assert (await client.post("/api/telemetry/client-errors", json={"message": "boom"})).status_code == 204
    assert sum(1 for r in caplog.records if r.getMessage().startswith("browser error")) == CLIENT_ERRORS_PER_MIN


# ---------------------------------------------------------------- what an error report may contain


def test_error_reports_keep_code_locations_and_lose_data():
    event = {
        "request": {"method": "POST", "url": "https://cv.example.org/api/resumes/1/chat?token=abc", "data": {"message": "my CV"},
                    "cookies": {"rm_session": "s"}, "headers": {"Cookie": "rm_session=s"}, "query_string": "token=abc"},
        "user": {"id": "u-1", "email": "jane@example.com", "ip_address": "1.2.3.4"},
        "extra": {"anything": "my CV"},
        "exception": {"values": [
            {"type": "ValidationError", "value": "input_value='Jane Doe, 12 Road'", "stacktrace": {"frames": [{"filename": "a.py", "lineno": 3, "vars": {"cv": "my CV"}}]}},
            {"type": "LLMError", "value": "The AI request failed. Please try again."},
        ]},
        "logentry": {"message": "imported CV failed validation: %s", "params": ["Jane Doe"]},
        "breadcrumbs": {"values": [{"category": "query", "message": "select ... 'Jane'", "data": {"params": ["Jane"]}}]},
    }
    out = errors.before_send(event, {})
    assert out["request"] == {"method": "POST", "url": "https://cv.example.org/api/resumes/1/chat"}
    assert out["user"] == {"id": "u-1"} and "extra" not in out
    first, second = out["exception"]["values"]
    assert first["value"] == "<redacted>" and "vars" not in first["stacktrace"]["frames"][0] and first["stacktrace"]["frames"][0]["lineno"] == 3
    assert second["value"] == "The AI request failed. Please try again."  # our own fixed sentences are kept
    assert out["logentry"] == {"message": "imported CV failed validation: %s"}
    assert out["breadcrumbs"]["values"] == [{"category": "query"}]
    assert "Jane" not in json.dumps(out) and "my CV" not in json.dumps(out)


def test_span_data_is_dropped_from_traces():
    tx = {"spans": [{"op": "db", "description": "select 1", "data": {"db.params": ["Jane"]}}], "request": {"url": "https://x/api?q=1"}}
    out = errors.before_send_transaction(tx, {})
    assert out["spans"] == [{"op": "db", "description": "select 1"}] and out["request"]["url"] == "https://x/api"


def test_telemetry_is_off_unless_configured(infra):
    assert not infra.settings.sentry_dsn and not errors.enabled()  # tests and a bare checkout send nothing anywhere
