# ResuMaker: every way to build, run, test and poke the project. `make` (or `make help`) lists the targets.
#
# Two completely separate stacks:
#   FROZEN   (stable-*)  your real data, pre-built images from a git tag, nothing here can change it. http://localhost:5174
#   SCRATCH  (the rest)  a throwaway copy with its own database, built from the working tree.       http://localhost:5180
#
#   make stack            # scratch: full build + start, wait until healthy (no hot reload)
#   make stack HOT=1      # scratch with hot reload (bind mounts)
#   make scratch-reset    # throw the scratch stack away completely

.DEFAULT_GOAL := help
SHELL := /bin/bash

# The scratch stack (docker-compose.yml). HOT=1 layers the bind-mount / hot-reload override on top.
COMPOSE  := docker compose -f docker-compose.yml $(if $(HOT),-f docker-compose.hot.yml)
WEB_PORT ?= 5180
API_PORT ?= 8180
export WEB_PORT API_PORT          # docker-compose.yml reads these for the published host ports
# Host-side targets (local-api, test-local, mcp-*) talk to the SCRATCH database/cache, never to the frozen stack's.
SCRATCH_DB    := postgresql+asyncpg://resumaker:resumaker@localhost:5434/resumaker
SCRATCH_REDIS := redis://localhost:6381/0

# The frozen stack (docker-compose.stable.yml): pre-built images from a git tag, no bind mounts, your real data.
-include stable.env               # local, git-ignored: written by `make stable-expose` / `stable-hide`
STABLE_TAG      ?= stable-1
STABLE_WEB_PORT ?= 5174
STABLE_BIND     ?= 127.0.0.1      # 0.0.0.0 = reachable from the local network
STABLE          := docker compose -f docker-compose.stable.yml
LAN_IP          := $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $$1}')
LAN_NAME        := $(shell scutil --get LocalHostName 2>/dev/null)
export STABLE_TAG STABLE_WEB_PORT STABLE_BIND

##@ Help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nUsage: make \033[36m<target>\033[0m [WEB_PORT=$(WEB_PORT)] [API_PORT=$(API_PORT)]\n"} \
		/^##@/{printf "\n\033[1m%s\033[0m\n", substr($$0,5)} \
		/^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo

##@ Frozen stack (the stable build, with your real data: no hot reload, immune to edits in this repo)

.PHONY: stable-build stable-up stable-expose stable-hide stable-down stable-restart stable-ps stable-logs stable-status stable-backup stable-mcp
stable-build: ## Build the frozen images from git tag STABLE_TAG (committed code only, never the working tree)
	@git rev-parse --verify --quiet refs/tags/$(STABLE_TAG) >/dev/null || { echo "No git tag '$(STABLE_TAG)'."; exit 1; }
	git archive $(STABLE_TAG):backend | docker build -t resumaker-api:$(STABLE_TAG) -
	git archive $(STABLE_TAG) | docker build -f Dockerfile.web.static -t resumaker-web:$(STABLE_TAG) -

stable-up: ## Start / update the frozen stack (http://localhost:STABLE_WEB_PORT)
	@$(MAKE) --no-print-directory check-ports WEB_PORT=$(STABLE_WEB_PORT) MAKECMDGOALS=stable-up
	$(STABLE) up -d --wait --remove-orphans
	@echo; echo "  Frozen app  http://localhost:$(STABLE_WEB_PORT)   (build: $(STABLE_TAG))"
	@if [ "$(STABLE_BIND)" = "0.0.0.0" ]; then \
		echo "  On the LAN  http://$(LAN_IP):$(STABLE_WEB_PORT)$(if $(LAN_NAME),   or   http://$(LAN_NAME).local:$(STABLE_WEB_PORT))"; \
		echo "  ⚠ Exposed: there is no login, so anyone on this network can read and edit every CV."; \
	fi; echo

stable-expose: ## Make the frozen app reachable from the local network (web port only; persists in stable.env)
	@echo "STABLE_BIND=0.0.0.0" > stable.env
	@$(MAKE) --no-print-directory stable-up STABLE_BIND=0.0.0.0

stable-hide: ## Back to localhost-only
	@echo "STABLE_BIND=127.0.0.1" > stable.env
	@$(MAKE) --no-print-directory stable-up STABLE_BIND=127.0.0.1

stable-down: ## Stop the frozen stack (containers removed, data kept)
	$(STABLE) down

stable-restart: ## Restart the frozen containers
	$(STABLE) restart

stable-ps: ## Frozen stack status
	$(STABLE) ps

stable-logs: ## Follow frozen api + web logs
	$(STABLE) logs -f --tail=100 api web

stable-status: ## Frozen stack health: AI / PDF / database / cache
	@curl -fsS localhost:$(STABLE_WEB_PORT)/api/status && echo

stable-backup: ## Dump the frozen stack's database to backups/ (git-ignored: personal data)
	@mkdir -p backups
	@f=backups/resumaker-$$(date +%Y%m%d-%H%M%S).sql; $(STABLE) exec -T db pg_dump -U resumaker resumaker > $$f && echo "Wrote $$f"

stable-mcp: ## MCP over stdio against the frozen stack
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

down-volumes: ## Stop and DELETE the scratch database too (never the frozen stack's; asks first, FORCE=1 skips)
	@if [ "$(FORCE)" != "1" ]; then read -r -p "This deletes the SCRATCH stack's database (the frozen stack is not touched). Type 'yes' to continue: " a; [ "$$a" = "yes" ] || { echo "Aborted."; exit 1; }; fi
	$(COMPOSE) down -v

scratch-reset: down-volumes ## Same as down-volumes: wipe the scratch stack back to nothing

ps: ## Show container status
	$(COMPOSE) ps

urls:
	@echo
	@echo "  Scratch app  http://localhost:$(WEB_PORT)$(if $(HOT),   (hot reload),   (built, no hot reload))"
	@echo "  API          http://localhost:$(API_PORT)/api/status   (docs: /docs)"
	@echo "  Agent        http://localhost:$(API_PORT)/api/agent/graph"
	@echo "  Postgres     localhost:5434   Redis  localhost:6381   (scratch; your real data is on the frozen stack)"
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
	cd backend && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) FRONTEND_URL=http://localhost:5173 uv run uvicorn app.main:app --reload --port $(API_PORT)

local-web: ## Frontend on the host: Vite dev server (proxies /api to localhost:API_PORT)
	API_URL=http://localhost:$(API_PORT) npm run dev

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
	cd backend && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) uv run pytest -q

eval-router: ## Live router accuracy check against real Gemini (uses GEMINI_API_KEY from .env; costs a few cents)
	cd backend && set -a && . ../.env && set +a && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) uv run pytest -m live -s -q tests/test_router_eval.py

eval-agent: ## Live end-to-end eval of the editing agent (13 tasks, real Gemini; prints pass rate, repairs, latency)
	cd backend && set -a && . ../.env && set +a && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) uv run pytest -m live -s -q tests/evals

test-web: ## Frontend unit tests (Markdown helpers), on the host
	npx vitest run

typecheck: ## TypeScript type-check
	npx tsc -b

web-build: ## Production build of the frontend into dist/
	npm run build

check: typecheck test-web test ## Type-check + frontend unit tests + backend tests

##@ MCP server (for Claude Desktop / Claude Code)

.PHONY: eval-router eval-agent
.PHONY: mcp mcp-local mcp-http
mcp: ## MCP over stdio, in Docker (what a client config runs)
	$(COMPOSE) run --rm -T mcp

mcp-local: ## MCP over stdio, on the host (scratch database)
	cd backend && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) uv run python -m app.mcp_server

mcp-http: ## MCP over streamable HTTP on the host, scratch database: http://127.0.0.1:8101/mcp
	cd backend && DATABASE_URL=$(SCRATCH_DB) REDIS_URL=$(SCRATCH_REDIS) uv run python -m app.mcp_server --http

##@ Inspect the running stack

.PHONY: status graph graph-mermaid graph-json graph-html personas cvs pdf psql redis-cli shell-api shell-web
status: ## API health: AI / PDF / database / cache
	@curl -fsS localhost:$(API_PORT)/api/status && echo

graph: ## Draw the LangGraph agent as ASCII
	@curl -fsS "localhost:$(API_PORT)/api/agent/graph"

graph-mermaid: ## The agent graph as Mermaid source
	@curl -fsS "localhost:$(API_PORT)/api/agent/graph?format=mermaid"

graph-json: ## The agent graph as JSON (nodes, edges, descriptions)
	@curl -fsS "localhost:$(API_PORT)/api/agent/graph?format=json"; echo

graph-html: ## URL of the agent graph rendered in a browser
	@echo "http://localhost:$(API_PORT)/api/agent/graph?format=html"

personas: ## List the personas (people) and how many CVs each has
	@curl -fsS localhost:$(API_PORT)/api/personas | python3 -c "import sys,json; [print(f\"{p['id']}  {p['firstName']} {p['lastName']}  ({p['resumeCount']} CV)\") for p in json.load(sys.stdin)]"

cvs: ## List one persona's CVs: make cvs PERSONA=<persona id>   (ids: make personas)
	@test -n "$(PERSONA)" || { echo "Usage: make cvs PERSONA=<persona id>   (ids: make personas)"; exit 1; }
	@curl -fsS localhost:$(API_PORT)/api/personas/$(PERSONA) | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['persona']['firstName'], d['persona']['lastName']); [print(f\"  {r['id']}  {r['title']}  [{r['layoutId']}]\") for r in d['resumes']]"

pdf: ## Download a CV as PDF: make pdf ID=<cv id> [OUT=cv.pdf]
	@test -n "$(ID)" || { echo "Usage: make pdf ID=<cv id>   (ids: make personas, then make cvs PERSONA=...)"; exit 1; }
	curl -fS -X POST -H 'x-resumaker: 1' -o "$(or $(OUT),cv.pdf)" localhost:$(API_PORT)/api/resumes/$(ID)/pdf
	@echo "Saved $(or $(OUT),cv.pdf)"

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
