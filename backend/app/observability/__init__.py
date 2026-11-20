"""Telemetry (issue #24): request ids and structured logs, Prometheus metrics, Sentry errors and traces.

Everything here is optional and off unless configured: no SENTRY_DSN = nothing leaves the process; no METRICS_TOKEN =
/api/metrics answers 404. Only ids, counts, durations and outcomes are reported, never CV or chat text (see SECURITY.md).
"""
