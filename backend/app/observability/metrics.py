"""Prometheus metrics, served at GET /api/metrics with `Authorization: Bearer $METRICS_TOKEN` (404 without a token configured).

Labels are bounded on purpose: route *templates* (never raw paths with ids), models, graph nodes, features, outcomes. No user
ids: per-person usage lives in the ai_usage table, where only admins can read it.
"""

from __future__ import annotations

from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from .. import usage

# ---------------------------------------------------------------- HTTP

HTTP_REQUESTS = Counter("resumaker_http_requests_total", "HTTP requests handled by the API.", ["method", "route", "status"])
HTTP_DURATION = Histogram(
    "resumaker_http_request_duration_seconds", "Time to the end of the response (streams: the whole stream).", ["method", "route"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120),
)
REJECTED = Counter("resumaker_rejected_total", "Requests refused by a limit or an entitlement.", ["reason"])  # rate_limit, daily_limit, not_entitled, login
UP = Gauge("resumaker_up", "Whether a dependency answers (1) or not (0), checked at scrape time.", ["component"])
PDF_SECONDS = Histogram("resumaker_pdf_render_seconds", "Headless Chrome PDF renders (cache misses).", buckets=(0.5, 1, 2, 3, 5, 8, 13, 20, 30, 60))
PDF_FAILURES = Counter("resumaker_pdf_render_failures_total", "PDF renders that failed.")
CLIENT_ERRORS = Counter("resumaker_client_errors_total", "Errors reported by browsers.")

# ---------------------------------------------------------------- AI

AI_CALLS = Counter("resumaker_ai_calls_total", "Model calls.", ["model", "node", "kind", "outcome"])
AI_CALL_SECONDS = Histogram("resumaker_ai_call_duration_seconds", "Latency of one model call.", ["model", "node"],
                            buckets=(0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120))
AI_TOKENS = Counter("resumaker_ai_tokens_total", "Tokens, as the provider reports them (thinking counts as output).", ["model", "direction"])
AI_COST = Counter("resumaker_ai_cost_usd_total", "Estimated spend, from AI_PRICES.", ["model"])
AI_REQUESTS = Counter("resumaker_ai_requests_total", "AI requests (one per user action), by outcome.", ["feature", "source", "status", "intent"])
AI_REQUEST_SECONDS = Histogram("resumaker_ai_request_duration_seconds", "One whole AI request.", ["feature"],
                               buckets=(0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120))
AI_REPAIRS = Counter("resumaker_ai_repair_rounds_total", "Repair rounds (the model fixing ops that failed to apply).")
AI_CRITIC = Counter("resumaker_ai_critic_rounds_total", "Critic rounds.")
AI_GUARD = Counter("resumaker_ai_guard_rejections_total", "Ops refused by the contact guard (links/emails/phones nobody provided).")
AI_OPS = Counter("resumaker_ai_ops_total", "Ops the agent applied or had rejected.", ["result"])

_settings: Any = None


def _on_call(scope: usage.Scope | None, call: usage.Call) -> None:
    node = call.node or (scope.feature if scope else "none")
    AI_CALLS.labels(call.model, node, call.kind, "ok" if call.ok else "error").inc()
    AI_CALL_SECONDS.labels(call.model, node).observe(call.ms / 1000)
    AI_TOKENS.labels(call.model, "input").inc(call.input_tokens)
    AI_TOKENS.labels(call.model, "output").inc(call.output_tokens)
    if _settings is not None:
        AI_COST.labels(call.model).inc(_settings.cost_usd(call.model, call.input_tokens, call.output_tokens))


def _on_scope_end(scope: usage.Scope) -> None:
    AI_REQUESTS.labels(scope.feature, scope.source, scope.status, scope.intent or "none").inc()
    if scope.status == "rejected" and scope.reason:
        REJECTED.labels(scope.reason).inc()
        return
    AI_REQUEST_SECONDS.labels(scope.feature).observe(scope.latency_ms / 1000)
    AI_REPAIRS.inc(scope.repairs)
    AI_CRITIC.inc(scope.critic_rounds)
    AI_GUARD.inc(scope.guard_rejections)
    AI_OPS.labels("applied").inc(scope.ops_applied)
    AI_OPS.labels("rejected").inc(scope.ops_rejected)


def install(settings: Any) -> None:
    """Feed the AI metrics from the usage hooks. Idempotent (create_app may run more than once in a process)."""
    global _settings
    _settings = settings
    if _on_call not in usage.on_call:
        usage.on_call.append(_on_call)
    if _on_scope_end not in usage.on_scope_end:
        usage.on_scope_end.append(_on_scope_end)


def observe_http(method: str, route: str, status: int, seconds: float) -> None:
    HTTP_REQUESTS.labels(method, route, str(status)).inc()
    HTTP_DURATION.labels(method, route).observe(seconds)


async def render(infra: Any) -> tuple[bytes, str]:
    for component, ok in (await infra.status()).items():
        UP.labels(component).set(1 if ok else 0)
    return generate_latest(), CONTENT_TYPE_LATEST
