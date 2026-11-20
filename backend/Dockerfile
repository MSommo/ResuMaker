# The API image: Python + Chromium (for PDF rendering). Runs as-is on the scratch and stable stacks and on Railway;
# docker-compose.hot.yml bind-mounts the code and adds --reload for development.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1

# Chromium renders the CV to PDF; fonts-liberation avoids missing-glyph fallbacks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.4 /uv /usr/local/bin/uv

# An unprivileged user. Chromium needs a writable home for its profile and crash reports.
RUN useradd --system --uid 10001 --create-home --home-dir /home/app --shell /usr/sbin/nologin app

WORKDIR /app
# Dependencies first, so editing code doesn't invalidate this layer. The venv lives outside /app so the bind mount can't hide it.
# Dev dependencies included: `make test` runs pytest in this image.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY --chown=app:app . .
RUN uv sync --frozen && chown app:app /app

USER app
EXPOSE 8100

# PORT: Railway sets it (set it to 8100 on the API service so the web service's BACKEND_URL is stable).
# API_HOST: "::" listens on IPv6 too, which Railway's private network needs; docker compose passes 0.0.0.0.
# --proxy-headers: the client address comes from X-Forwarded-For, but only when the request arrives from a private address
# (nginx in the same Docker / Railway network). nginx overwrites that header with the one address it worked out, so a
# client can't choose its own. Migrations run on start (Infra.start), serialised by a Postgres advisory lock.
CMD ["sh", "-c", "exec uvicorn app.main:app --host \"${API_HOST:-::}\" --port \"${PORT:-8100}\" --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,fc00::/7}\""]
