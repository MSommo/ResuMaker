# Development image for the API: Python + Chromium (for PDF rendering). Code is bind-mounted by docker-compose.yml for hot reload.
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

WORKDIR /app
# Dependencies first, so editing code doesn't invalidate this layer. The venv lives outside /app so the bind mount can't hide it.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY . .
RUN uv sync --frozen

EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--reload", "--reload-dir", "app"]
