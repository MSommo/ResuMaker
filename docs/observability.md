# Observability

How to tell that ResuMaker is broken, slow or expensive before anyone has to report it (issue #24), and how much each person
uses the AI (issue #25). Everything here is **off unless configured**, and never handles CV content, chat text, emails
or other personal data: ids, counts, durations and outcomes only.

| What | Where | Turn it on |
|---|---|---|
| Request ids | `X-Request-ID` on every API response; on every log line, error report and AI usage row | always on |
| Structured logs | one JSON object per line in production | always on (`LOG_FORMAT=auto`: JSON with `APP_ENV=production`) |
| Error reports + traces | Sentry: API exceptions, browser errors (sent through the API), one span per agent graph node | `SENTRY_DSN` |
| Metrics | Prometheus text at `GET /api/metrics` | `METRICS_TOKEN` (404 without one) |
| Dashboard and alerts | `ops/grafana/resumaker.json`, `ops/prometheus/alerts.yml` | import them |
| AI use per person | admin Users page: *AI use* column and row detail | always on (`ai_usage` table, 90 days) |

## Request ids

nginx gives every request an id (`$request_id`) and passes it to the API as `X-Request-ID`, replacing anything the
client sent. The API also accepts one when called directly, and makes one up when there is none. The id is returned in the
response's `X-Request-ID` header, printed on every log line written while handling the request, tagged on error reports
and traces (`request_id`), and stored on the request's AI usage row. To follow one request through everything, search
any of them for the id.

## Logs

`LOG_FORMAT=auto` (the default) writes JSON lines in production and readable text otherwise; `json` / `text` force
one. Each JSON line has `ts`, `level`, `logger`, `msg`, `request_id` and, for errors, `exc`. Railway's log search
parses them (`@level:error`, `@request_id:…`). uvicorn's access log is quiet in production: the HTTP metrics count the
same thing without full URLs.

What is logged: failed sign-ins with the client address, admin actions by id, warnings from the AI and cache layers
without request bodies, browser errors with their message redacted. Never passwords, tokens, CV content or chat text.

## Error reports and traces (Sentry)

Set `SENTRY_DSN` on the API service. `SENTRY_TRACES_SAMPLE_RATE` (default `0.1`) is the share of requests traced. The
environment is `APP_ENV` and the release is `RELEASE`, or Railway's `RAILWAY_GIT_COMMIT_SHA`.

- **API exceptions** arrive with their stack (file, function, line), the route, the request id and the user's **id**.
  Scrubbed out before sending (`backend/app/observability/errors.py`): request bodies, query strings, cookies, headers,
  local variables, log arguments, span data, and exception messages, which can quote SQL parameters, CV text or an email.
  Messages are kept only for our own exception types, whose messages are fixed sentences (`LLMError` and a few others).
- **Browser errors** are posted to `POST /api/telemetry/client-errors` (signed-in users, 10 per user per minute), and
  the API forwards them. The browser never contacts Sentry: no SDK in the bundle, no CSP change, same scrubbing. Their
  message has emails and phone-like numbers replaced, and only the path is kept, never the query.
- **Traces**: one transaction per request, with a span per agent graph node (`agent.route`, `agent.plan`, `agent.write`,
  `agent.critic`, `agent.repair`, ...) plus database, Redis and Gemini HTTP spans.

Suggested Sentry alerts: a new issue, and an issue spiking above its usual rate.

## Metrics (Prometheus)

`GET /api/metrics` with `Authorization: Bearer $METRICS_TOKEN`. Without `METRICS_TOKEN` it answers 404, and a wrong
token gets 401. Labels are bounded: route templates such as `/api/resumes/{resume_id}/chat`, never ids. There is no
per-user label: per-person use is on the admin Users page.

| Metric | Labels | What |
|---|---|---|
| `resumaker_http_requests_total` | method, route, status | requests handled |
| `resumaker_http_request_duration_seconds` | method, route | time to the end of the response (streams: the whole stream) |
| `resumaker_up` | component (db, cache, ai, pdf) | 1 if it answers, checked at scrape time |
| `resumaker_rejected_total` | reason (rate_limit, daily_limit, not_entitled, login) | refused requests |
| `resumaker_pdf_render_seconds`, `resumaker_pdf_render_failures_total` | | headless Chrome renders (cache misses) |
| `resumaker_client_errors_total` | | browser errors reported |
| `resumaker_ai_calls_total` | model, node, kind, outcome | model calls, per agent graph node (or the feature, outside the graph) |
| `resumaker_ai_call_duration_seconds` | model, node | latency of one model call |
| `resumaker_ai_tokens_total` | model, direction | tokens as Gemini reports them (thinking counts as output) |
| `resumaker_ai_cost_usd_total` | model | estimated spend, from `AI_PRICES` |
| `resumaker_ai_requests_total` | feature, source, status, intent | one per user action; intent is the router's (incl. `off_topic`) |
| `resumaker_ai_request_duration_seconds` | feature | one whole AI request |
| `resumaker_ai_repair_rounds_total`, `resumaker_ai_critic_rounds_total` | | agent loops |
| `resumaker_ai_guard_rejections_total` | | ops refused by the contact guard |
| `resumaker_ai_ops_total` | result (applied, rejected) | what the agent changed |

### On Railway

Railway has no Prometheus of its own, so something must scrape the API. Either:

- **Grafana Cloud** (free tier): add a *Metrics Endpoint* scrape job for `https://<your domain>/api/metrics` with bearer
  auth `METRICS_TOKEN`. The web service proxies `/api/`, so the API itself stays private. Then import the dashboard and
  the alert rules there.
- **A Prometheus service** in the same Railway project, scraping `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8100/api/metrics`
  over the private network with the same token, plus Grafana.

Use a long random `METRICS_TOKEN`: the metrics have no personal data, but they do describe traffic and spend.

### Dashboard and alerts

- `ops/grafana/resumaker.json`: import it in Grafana and pick the Prometheus data source. It has: requests/s, 5xx rate,
  AI spend in the last 24 h, LLM failure rate, requests by status, latency (p50/p95) and the slowest routes, refusals
  by reason, AI calls by node, model latency, tokens and spend by model, router intents, AI outcomes by feature,
  repair/critic/guard rounds, ops applied vs rejected, dependencies, and PDF render times.
- `ops/prometheus/alerts.yml`: API down, database or Redis down, 5xx rate above 5%, LLM failure rate above 20%, slow
  requests, slow AI, and daily AI spend above a threshold. Thresholds are starting points (the spend one is $5/day):
  tune them. `promtool check rules ops/prometheus/alerts.yml` validates the file.

## AI use per person (admin Users page)

Every AI request (assistant turn, Improve, tailoring, CV import, memory added by hand; from the web app or MCP) and every
refused attempt (per-minute limit, daily limit, AI off for the account) is one row in `ai_usage`. A row holds the feature,
source, the router's intent, models and token counts, estimated cost, latency, outcome, ops applied, rejected or blocked by
the contact guard, repair and critic rounds, and the request id. **Never the prompt, the CV or the chat text.** Rows are
written in the background once the request ends, so a client that hangs up (the Stop button) is recorded too. They're
deleted after `AI_USAGE_RETENTION_DAYS` (90). Refusals are capped at 20 stored rows per user per minute, so a client
hammering a limit can't flood the table (the metrics still count every one).

Admins see, per person: AI requests today (against the daily limit, flagged from 80%), in 7 and 30 days, tokens,
estimated cost, failures, refusals, the share of off-topic chat, and last use. They can sort and filter by these. Opening a
row shows requests per day (completed vs failed or refused), a breakdown by feature and by model, and the latest requests.
`GET /api/admin/users/{id}/ai-usage?from=&to=` serves the same data (admins only, at most 90 days at a time).

**Costs are estimates**, from `AI_PRICES` (USD per million tokens, `{"model": [input, output]}`). The defaults are
deliberately on the high side for the default models. Check
[Google's pricing](https://ai.google.dev/gemini-api/docs/pricing) and set your own, especially if you change
`GEMINI_MODEL`. A model without a price counts as $0, and the page says so.
