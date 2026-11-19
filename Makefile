# ResuMaker: every way to build, run, test and poke the project. `make` (or `make help`) lists the targets.
#
#   make stack                     # full build + start the whole stack (Docker), wait until healthy
#   make stack WEB_PORT=5174       # same, if something else already uses 5173

.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE  ?= docker compose
WEB_PORT ?= 5173
API_PORT ?= 8100
export WEB_PORT API_PORT          # docker-compose.yml reads these for the published host ports

##@ Help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nUsage: make \033[36m<target>\033[0m [WEB_PORT=$(WEB_PORT)] [API_PORT=$(API_PORT)]\n"} \
		/^##@/{printf "\n\033[1m%s\033[0m\n", substr($$0,5)} \
		/^[a-zA-Z0-9_-]+:.*##/{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo

##@ Full stack (Docker: web + api + db + redis, hot reload)

.PHONY: stack stack-fresh up up-d start stop restart down down-volumes ps urls
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

down: ## Stop and remove containers (the database volume is kept)
	$(COMPOSE) down

down-volumes: ## ⚠ Stop and DELETE the database (asks first; FORCE=1 skips the question)
	@if [ "$(FORCE)" != "1" ]; then read -r -p "This permanently deletes ALL CVs. Type 'yes' to continue: " a; [ "$$a" = "yes" ] || { echo "Aborted."; exit 1; }; fi
	$(COMPOSE) down -v

ps: ## Show container status
	$(COMPOSE) ps

urls:
	@echo
	@echo "  App        http://localhost:$(WEB_PORT)"
	@echo "  API        http://localhost:$(API_PORT)/api/status   (docs: /docs)"
	@echo "  Agent      http://localhost:$(API_PORT)/api/agent/graph"
	@echo "  Postgres   localhost:5433   Redis  localhost:6380"
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

local-api: ## API on the host: uvicorn --reload (needs uv, Chrome; Postgres/Redis from `make infra`)
	cd backend && uv run uvicorn app.main:app --reload --port $(API_PORT)

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

.PHONY: test test-local typecheck web-build check
test: ## Backend tests, in a container (own test DB + Redis db 15)
	$(COMPOSE) run --rm -T api pytest -q

test-local: ## Backend tests on the host (needs `make infra`)
	cd backend && uv run pytest -q

typecheck: ## TypeScript type-check
	npx tsc -b

web-build: ## Production build of the frontend into dist/
	npm run build

check: typecheck test ## Type-check + backend tests

##@ MCP server (for Claude Desktop / Claude Code)

.PHONY: mcp mcp-local mcp-http
mcp: ## MCP over stdio, in Docker (what a client config runs)
	$(COMPOSE) run --rm -T mcp

mcp-local: ## MCP over stdio, on the host
	cd backend && uv run python -m app.mcp_server

mcp-http: ## MCP over streamable HTTP on the host: http://127.0.0.1:8101/mcp
	cd backend && uv run python -m app.mcp_server --http

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
