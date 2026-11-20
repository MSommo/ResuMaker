# ResuMaker: every way to build, run, test and poke the project. `make` (or `make help`) lists the targets.
#
# Two completely separate stacks:
#   STABLE   (stable-*)  your real data, pre-built images from a git tag, nothing here can change it. http://localhost:5174
#   SCRATCH  (the rest)  a throwaway copy with its own database, built from the working tree.       http://localhost:5180
#
# Every address below is built from variables (APP_HOST, *_PORT), so `make <target> APP_HOST=… WEB_PORT=…` moves it.
#
#   make stack            # scratch: full build + start, wait until healthy (no hot reload)
#   make stack HOT=1      # scratch with hot reload (bind mounts)
#   make scratch-reset    # throw the scratch stack away completely

.DEFAULT_GOAL := help
SHELL := /bin/bash

# The scratch stack (docker-compose.yml). HOT=1 layers the bind-mount / hot-reload override on top.
COMPOSE  := docker compose -f docker-compose.yml $(if $(HOT),-f docker-compose.hot.yml)
# (No comments after values in this block: make keeps the spaces before a `#` as part of the value.)
# APP_HOST: where this machine's published ports are reached. Not HOST: zsh already uses that name.
# DEV_WEB_PORT: the Vite dev server of `make local-web`.
# MCP_HOST: `make mcp-http` binds here. Keep it on loopback: the server acts as one user without asking who is calling.
APP_HOST           ?= localhost
WEB_PORT           ?= 5180
API_PORT           ?= 8180
SCRATCH_PG_PORT    ?= 5434
SCRATCH_REDIS_PORT ?= 6381
DEV_WEB_PORT       ?= 5173
MCP_HOST           ?= 127.0.0.1
MCP_HTTP_PORT      ?= 8101
# docker-compose.yml reads these for the published host ports and the invite-link address.
export APP_HOST WEB_PORT API_PORT SCRATCH_PG_PORT SCRATCH_REDIS_PORT
WEB_URL = http://$(APP_HOST):$(WEB_PORT)
API_URL = http://$(APP_HOST):$(API_PORT)
# Host-side targets (local-api, test-local, mcp-*) talk to the SCRATCH database/cache, never to the stable stack's.
SCRATCH_DB    ?= postgresql+asyncpg://resumaker:resumaker@$(APP_HOST):$(SCRATCH_PG_PORT)/resumaker
SCRATCH_REDIS ?= redis://$(APP_HOST):$(SCRATCH_REDIS_PORT)/0
SCRATCH_ENV    = DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS)

# The stable stack (docker-compose.stable.yml): pre-built images from a git tag, no bind mounts, your real data.
-include stable.env               # local, git-ignored: written by `make stable-expose` / `stable-hide`
STABLE_TAG      ?= stable
STABLE_WEB_PORT ?= 5174
STABLE_API_PORT ?= 8100
STABLE_PG_PORT  ?= 5433
STABLE_REDIS_PORT ?= 6380
# STABLE_BIND: 0.0.0.0 = reachable from the local network (no comment after the value: make would keep the spaces).
STABLE_BIND     ?= 127.0.0.1
STABLE_URL       = http://$(APP_HOST):$(STABLE_WEB_PORT)
STABLE          := docker compose -f docker-compose.stable.yml
LAN_IP          := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}')
LAN_NAME        := $(shell scutil --get LocalHostName 2>/dev/null)
export STABLE_TAG STABLE_WEB_PORT STABLE_API_PORT STABLE_PG_PORT STABLE_REDIS_PORT STABLE_BIND

##@ Help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nUsage: make \033[36m<target>\033[0m [WEB_PORT=$(WEB_PORT)] [API_PORT=$(API_PORT)]\n"} \
		/^##@/{printf "\n\033[1m%s\033[0m\n", substr($$0,5)} \
		/^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo

##@ Stable stack (your real data: no hot reload, immune to edits in this repo)

.PHONY: stable-release stable-build stable-up stable-expose stable-hide stable-down stable-restart stable-ps stable-logs stable-status stable-backup stable-mcp
stable-build: ## Build the stable images from git tag STABLE_TAG (committed code only, never the working tree)
	@git rev-parse --verify --quiet refs/tags/$(STABLE_TAG) >/dev/null || { echo "No git tag '$(STABLE_TAG)'."; exit 1; }
	git archive $(STABLE_TAG):backend | docker build -t resumaker-api:$(STABLE_TAG) -
	git archive $(STABLE_TAG) | docker build -f Dockerfile.web.static -t resumaker-web:$(STABLE_TAG) -

stable-release: ## REBUILD the stable app from the latest commit (moves the `stable` tag to HEAD, builds, restarts: brief downtime)
	@test -z "$$(git status --porcelain)" || { echo "Commit or stash your changes first: the stable app is built from a commit."; exit 1; }
	git tag -f stable HEAD
	@$(MAKE) --no-print-directory stable-build STABLE_TAG=stable
	@$(MAKE) --no-print-directory stable-up STABLE_TAG=stable

stable-up: ## Start / update the stable stack (http://APP_HOST:STABLE_WEB_PORT)
	@$(MAKE) --no-print-directory check-ports WEB_PORT=$(STABLE_WEB_PORT) MAKECMDGOALS=stable-up
	$(STABLE) up -d --wait --remove-orphans
	@echo; echo "  Stable app  $(STABLE_URL)   (build: $(STABLE_TAG))"
	@if [ "$(STABLE_BIND)" = "0.0.0.0" ]; then \
		echo "  On the LAN  http://$(LAN_IP):$(STABLE_WEB_PORT)$(if $(LAN_NAME),   or   http://$(LAN_NAME).local:$(STABLE_WEB_PORT))"; \
		echo "  ⚠ Exposed over plain HTTP: passwords and sessions cross the network unencrypted. Only on a network you trust."; \
	fi; echo

stable-expose: ## Make the stable app reachable from the local network (web port only; persists in stable.env)
	@echo "STABLE_BIND=0.0.0.0" > stable.env
	@$(MAKE) --no-print-directory stable-up STABLE_BIND=0.0.0.0

stable-hide: ## Back to localhost-only
	@echo "STABLE_BIND=127.0.0.1" > stable.env
	@$(MAKE) --no-print-directory stable-up STABLE_BIND=127.0.0.1

stable-down: ## Stop the stable stack (containers removed, data kept)
	$(STABLE) down

stable-restart: ## Restart the stable containers
	$(STABLE) restart

stable-ps: ## Stable stack status
	$(STABLE) ps

stable-logs: ## Follow stable api + web logs
	$(STABLE) logs -f --tail=100 api web

stable-status: ## Stable stack health: AI / PDF / database / cache
	@curl -fsS $(STABLE_URL)/api/status && echo

stable-backup: ## Dump the stable stack's database to backups/ (git-ignored: personal data)
	@mkdir -p backups
	@f=backups/resumaker-$$(date +%Y%m%d-%H%M%S).sql; $(STABLE) exec -T db pg_dump -U resumaker resumaker > $$f && echo "Wrote $$f"

stable-mcp: ## MCP over stdio against the stable stack
	$(STABLE) run --rm -T mcp

##@ Scratch stack (throwaway: own database, built from the working tree; HOT=1 adds hot reload)

.PHONY: stack stack-fresh up up-d start stop restart down down-volumes scratch-reset ps urls
stack: env check-ports ## FULL BUILD: build every image, start everything, wait until healthy
	$(COMPOSE) up -d --build --wait --remove-orphans
	@$(MAKE) --no-print-directory urls

stack-fresh: env check-ports ## Like `stack`, but rebuilds all images from scratch (no cache)
	$(COMPOSE) build --no-cache --pull
	$(COMPOSE) up -d --force-recreate --wait --remove-orphans
	@$(MAKE) --no-print-directory urls

up: env check-ports ## Build and start in the foreground (Ctrl-C stops; shows all logs)
	$(COMPOSE) up --build

up-d: env check-ports ## Build and start in the background (no waiting)
	$(COMPOSE) up -d --build

start: ## Start already-created containers
	$(COMPOSE) start

stop: ## Stop containers (keeps them and the data)
	$(COMPOSE) stop

restart: check-ports ## Restart all containers
	$(COMPOSE) restart

down: ## Stop and remove the scratch containers (its database volume is kept)
	$(COMPOSE) down

down-volumes: ## Stop and DELETE the scratch database too (never the stable stack's; asks first, FORCE=1 skips)
	@if [ "$(FORCE)" != "1" ]; then read -r -p "This deletes the SCRATCH stack's database (the stable stack is not touched). Type 'yes' to continue: " a; [ "$$a" = "yes" ] || { echo "Aborted."; exit 1; }; fi
	$(COMPOSE) down -v

scratch-reset: down-volumes ## Same as down-volumes: wipe the scratch stack back to nothing

ps: ## Show container status
	$(COMPOSE) ps

urls:
	@echo
	@echo "  Scratch app  $(WEB_URL)$(if $(HOT),   (hot reload),   (built, no hot reload))"
	@echo "  API          $(API_URL)/api/status   (docs: /docs)"
	@echo "  Agent        $(WEB_URL)/api/agent/graph   (sign in first)"
	@echo "  Postgres     $(APP_HOST):$(SCRATCH_PG_PORT)   Redis  $(APP_HOST):$(SCRATCH_REDIS_PORT)   (scratch; your real data is on the stable stack)"
	@echo

##@ Images

.PHONY: build build-api build-web rebuild
build: ## Build all images (uses cache)
	$(COMPOSE) build

build-api: ## Build only the API image (needed after changing backend dependencies)
	$(COMPOSE) build api

build-web: ## Build only the web image
	$(COMPOSE) build web

rebuild: ## Build all images from scratch (no cache)
	$(COMPOSE) build --no-cache --pull

##@ Partial stacks

.PHONY: infra infra-down local local-api local-web
infra: env ## Only Postgres + Redis (for running api/web on your machine)
	$(COMPOSE) up -d --wait db redis

infra-down: ## Stop only Postgres + Redis
	$(COMPOSE) stop db redis

local: infra ## Run api + web on your machine instead of in containers (stops those two containers first)
	-$(COMPOSE) stop api web
	$(MAKE) -j2 local-api local-web

local-api: ## API on the host: uvicorn --reload (needs uv, Chrome; scratch Postgres/Redis from `make infra`)
	cd backend && $(SCRATCH_ENV) FRONTEND_URL=http://$(APP_HOST):$(DEV_WEB_PORT) uv run uvicorn app.main:app --reload --port $(API_PORT)

local-web: ## Frontend on the host: Vite dev server on DEV_WEB_PORT (proxies /api to APP_HOST:API_PORT)
	API_URL=$(API_URL) DEV_WEB_PORT=$(DEV_WEB_PORT) npm run dev

##@ Logs

.PHONY: logs logs-api logs-web logs-db logs-redis
logs: ## Follow api + web logs
	$(COMPOSE) logs -f --tail=100 api web

logs-api: ## Follow API logs
	$(COMPOSE) logs -f --tail=100 api

logs-web: ## Follow web (Vite) logs
	$(COMPOSE) logs -f --tail=100 web

logs-db: ## Follow Postgres logs
	$(COMPOSE) logs -f --tail=100 db

logs-redis: ## Follow Redis logs
	$(COMPOSE) logs -f --tail=100 redis

##@ Tests and checks

.PHONY: test test-local test-web typecheck web-build check
test: ## Backend tests in a container built from the working tree (own test DB + Redis db 15 on the scratch stack)
	$(COMPOSE) build api
	$(COMPOSE) run --rm -T -v "$(CURDIR)/src:/src:ro" api pytest -q

test-local: ## Backend tests on the host (needs `make infra`; uses the scratch database)
	cd backend && $(SCRATCH_ENV) uv run pytest -q

eval-router: ## Live router accuracy check against real Gemini (uses GEMINI_API_KEY from .env; costs a few cents)
	cd backend && set -a && . ../.env && set +a && $(SCRATCH_ENV) uv run pytest -m live -s -q tests/test_router_eval.py

eval-agent: ## Live end-to-end eval of the editing agent (13 tasks, real Gemini; prints pass rate, repairs, latency)
	cd backend && set -a && . ../.env && set +a && $(SCRATCH_ENV) uv run pytest -m live -s -q tests/evals

eval-tailor: ## Live eval of tailoring: honest gaps, nothing invented, prompt injection ignored (real Gemini)
	cd backend && set -a && . ../.env && set +a && $(SCRATCH_ENV) uv run pytest -m live -s -q tests/evals/test_tailor_eval.py

eval-memory: ## Live eval of memory: embedding thresholds, extraction, preferences applied, wrong memory ignored (real Gemini)
	cd backend && set -a && . ../.env && set +a && $(SCRATCH_ENV) uv run pytest -m live -s -q tests/evals/test_memory_eval.py

eval-import: ## Live round-trip eval of CV import: DOCX, HTML and PDF of a known CV, re-imported and compared (real Gemini; needs `make stack`)
	cd backend && set -a && . ../.env && set +a && $(SCRATCH_ENV) EVAL_API=$(API_URL)/api uv run pytest -m live -s -q tests/evals/test_import_eval.py

test-web: ## Frontend unit tests (Markdown helpers), on the host
	npx vitest run

typecheck: ## TypeScript type-check
	npx tsc -b

web-build: ## Production build of the frontend into dist/
	npm run build

check: typecheck test-web test ## Type-check + frontend unit tests + backend tests

.PHONY: hooks
hooks: ## Install the git hooks in .githooks (pre-commit: type-check + frontend tests; pre-push: backend tests)
	git config core.hooksPath .githooks
	@echo "Git hooks installed."

##@ MCP server (for Claude Desktop / Claude Code)

.PHONY: eval-router eval-agent eval-tailor eval-memory eval-import
.PHONY: mcp mcp-local mcp-http
mcp: ## MCP over stdio, in Docker (what a client config runs)
	$(COMPOSE) run --rm -T mcp

mcp-local: ## MCP over stdio, on the host (scratch database)
	cd backend && $(SCRATCH_ENV) uv run python -m app.mcp_server

mcp-http: ## MCP over streamable HTTP on the host, scratch database: http://MCP_HOST:MCP_HTTP_PORT/mcp
	cd backend && $(SCRATCH_ENV) uv run python -m app.mcp_server --http --host $(MCP_HOST) --port $(MCP_HTTP_PORT)

##@ Users and access (accounts are created by an administrator; the CLI is for the first one and for recovery)

.PHONY: users user-create user-invite user-passwd user-admin mcp-token stable-users stable-user-create stable-user-invite stable-user-passwd stable-user-admin stable-mcp-token
CLI        := python -m app.cli
need-login = @test -n "$(LOGIN)" || { echo "Usage: make $(1) LOGIN=<sign-in email>"; exit 1; }

users: ## List users (scratch stack)
	$(COMPOSE) exec -T api $(CLI) list
user-create: ## New user + one-time invite link: make user-create LOGIN=a@b.org FIRST=Ada [LAST=Lovelace] [ADMIN=1]
	@test -n "$(LOGIN)" -a -n "$(FIRST)" || { echo "Usage: make user-create LOGIN=<email> FIRST=<name> [LAST=<name>] [ADMIN=1]"; exit 1; }
	$(COMPOSE) exec -T api $(CLI) create-user --login "$(LOGIN)" --first "$(FIRST)" --last "$(LAST)" $(if $(ADMIN),--admin)
user-invite: ## New one-time link (not claimed yet, or forgotten password): make user-invite LOGIN=a@b.org
	$(call need-login,user-invite)
	$(COMPOSE) exec -T api $(CLI) invite --login "$(LOGIN)"
user-passwd: ## Set a password at the terminal (prompted, not echoed): make user-passwd LOGIN=a@b.org
	$(call need-login,user-passwd)
	$(COMPOSE) exec api $(CLI) set-password --login "$(LOGIN)"
user-admin: ## Make someone an administrator (REVOKE=1 to undo): make user-admin LOGIN=a@b.org
	$(call need-login,user-admin)
	$(COMPOSE) exec -T api $(CLI) make-admin --login "$(LOGIN)" $(if $(REVOKE),--revoke)
mcp-token: ## Access token for the MCP server (it acts as this user; shown once): make mcp-token LOGIN=a@b.org [NAME="Claude Desktop"]
	$(call need-login,mcp-token)
	$(COMPOSE) exec -T api $(CLI) token --login "$(LOGIN)" --name "$(or $(NAME),MCP)"

stable-users: ## List users (stable stack)
	$(STABLE) exec -T api $(CLI) list
stable-user-create: ## As user-create, on the stable stack
	@test -n "$(LOGIN)" -a -n "$(FIRST)" || { echo "Usage: make stable-user-create LOGIN=<email> FIRST=<name> [LAST=<name>] [ADMIN=1]"; exit 1; }
	$(STABLE) exec -T api $(CLI) create-user --login "$(LOGIN)" --first "$(FIRST)" --last "$(LAST)" $(if $(ADMIN),--admin)
stable-user-invite: ## As user-invite, on the stable stack
	$(call need-login,stable-user-invite)
	$(STABLE) exec -T api $(CLI) invite --login "$(LOGIN)"
stable-user-passwd: ## As user-passwd, on the stable stack
	$(call need-login,stable-user-passwd)
	$(STABLE) exec api $(CLI) set-password --login "$(LOGIN)"
stable-user-admin: ## As user-admin, on the stable stack
	$(call need-login,stable-user-admin)
	$(STABLE) exec -T api $(CLI) make-admin --login "$(LOGIN)" $(if $(REVOKE),--revoke)
stable-mcp-token: ## As mcp-token, on the stable stack
	$(call need-login,stable-mcp-token)
	$(STABLE) exec -T api $(CLI) token --login "$(LOGIN)" --name "$(or $(NAME),MCP)"

##@ Inspect the running stack

.PHONY: status graph graph-mermaid graph-json graph-html psql redis-cli shell-api shell-web
status: ## API health: AI / PDF / database / cache
	@curl -fsS $(API_URL)/api/status && echo

graph: ## Draw the LangGraph agent as ASCII (needs a session: this one runs inside the api container)
	@$(COMPOSE) exec -T api python -c "from app.agent.graph import build_graph; print(build_graph(None).get_graph().draw_ascii())"

graph-mermaid: ## The agent graph as Mermaid source
	@$(COMPOSE) exec -T api python -c "from app.agent.graph import build_graph; print(build_graph(None).get_graph().draw_mermaid())"

graph-json: ## Removed: the HTTP endpoint needs a signed-in session (sign in to the app, then open /api/agent/graph?format=json)
	@echo "Sign in to the app in your browser, then open  $(WEB_URL)/api/agent/graph?format=json"

graph-html: ## URL of the agent graph rendered in a browser (sign in first)
	@echo "$(WEB_URL)/api/agent/graph?format=html   (sign in to the app first)"

psql: ## Postgres shell
	$(COMPOSE) exec db psql -U resumaker resumaker

redis-cli: ## Redis shell
	$(COMPOSE) exec redis redis-cli

shell-api: ## Shell inside the API container
	$(COMPOSE) exec api bash

shell-web: ## Shell inside the web container
	$(COMPOSE) exec web sh

##@ Database

.PHONY: migrate migration db-backup
migrate: ## Apply database migrations (the API also does this on startup)
	$(COMPOSE) exec -T api alembic upgrade head

migration: ## Create a migration from model changes: make migration m="what changed"
	@test -n "$(m)" || { echo 'Usage: make migration m="what changed"'; exit 1; }
	$(COMPOSE) exec -T api alembic revision --autogenerate -m "$(m)"

db-backup: ## Dump the database to backups/ (git-ignored: it contains personal data)
	@mkdir -p backups
	@f=backups/resumaker-$$(date +%Y%m%d-%H%M%S).sql; $(COMPOSE) exec -T db pg_dump -U resumaker resumaker > $$f && echo "Wrote $$f"

##@ Setup and cleanup

.PHONY: env install clean check-ports
env: ## Create .env from .env.example if it doesn't exist (never overwrites)
	@test -f .env || { cp .env.example .env && echo "Created .env: add your GEMINI_API_KEY to enable AI."; }

install: ## Install dependencies on the host (only needed for `make local*` / test-local)
	npm install
	cd backend && uv sync

clean: ## Remove build output and caches (not containers, the database, backups or exported PDFs)
	rm -rf dist *.tsbuildinfo backend/.pytest_cache
	find backend -name __pycache__ -type d -prune -exec rm -rf {} +

# Fails early, naming the culprit, if another (non-Docker) process holds a port we need.
check-ports:
	@for p in $(WEB_PORT) $(API_PORT); do \
		who=$$(lsof -nP -iTCP:$$p -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && tolower($$1) !~ /docker|com.docke|vpnkit/ {print $$1" (pid "$$2")"; exit}'); \
		if [ -n "$$who" ]; then \
			echo "✗ Port $$p is in use by $$who."; \
			echo "  Stop it, or pick another port, e.g.:  make $(MAKECMDGOALS) WEB_PORT=5174 API_PORT=8101"; \
			exit 1; \
		fi; \
	done
