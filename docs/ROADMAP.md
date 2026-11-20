# Roadmap

Phases 1 to 4 are done (versions and undo, dry run, streaming, review mode with a Postgres checkpointer, router, planner, parallel writers, critic, tailor to a job). Each phase below ships with its own tests and, where quality matters, a live eval.

## Phase 5: Memory (pgvector)

Remember what is useful across sessions, per persona.
- **What is stored:** style preferences ("short bullets, no buzzwords"), facts you confirmed ("my title at Acme was Staff Engineer"), and the best bullets from past CVs. Always visible and editable in the UI, and removable one by one. Memory never overrides what is in the CV.
- **How:** a `memories` table (persona, kind, text, embedding `vector`, source CV, created) via an Alembic migration; the Postgres image becomes `pgvector/pgvector`. Embeddings from Gemini. The writers get the few most relevant memories as extra context.
- **Writes are explicit:** the assistant proposes "remember this?" and you accept; nothing is saved silently.
- **Eval:** does a remembered preference change the output, and does a wrong or stale memory ever beat the CV text (it must not).

## Phase 6: Find and import a job (URL, Indeed, LinkedIn)

Get a posting into the tailor flow without pasting. Researched options:

- **Indeed has an official MCP server** (beta, hosted at `mcp.indeed.com`, job search by title, keywords, location; sign-in through OAuth in a browser). It is built for MCP clients such as Claude, so the cleanest use is **at the client**: add it next to the ResuMaker MCP in Claude Code or Desktop, find a job there, and pass its text to `tailor_to_posting`. No scraping, no terms-of-service risk, no code in ResuMaker beyond a prompt (`tailor_to_job`) that spells out the two-step flow. Making ResuMaker's own server an MCP *client* of Indeed is possible but a poor fit: the OAuth sign-in is interactive and per person, and I have not confirmed that Indeed allows third-party apps to use it (only snippets of its docs were readable, so check docs.indeed.com/mcp first).
- **LinkedIn has no official MCP server.** The community ones work by driving a logged-in browser session on *your* account, which LinkedIn's terms prohibit; the repos say so themselves. The risk lands on your account (restrictions or a ban), not on us. Not built into ResuMaker's server. If you want one, use it at the client with a spare account, knowingly.
- **In the app: a plain "paste a URL" import** for open pages (company career sites, many boards), with the safety work that needs:
  - SSRF: HTTPS/HTTP only; resolve DNS and refuse private, loopback, link-local and cloud-metadata addresses, re-checked on every redirect (the server sits on a home network next to other services). Timeout, size cap, text content types only, no cookies or credentials.
  - Extraction order: schema.org `JobPosting` JSON-LD, then readable text (trafilatura), then Chrome for JavaScript-only pages, behind the same address checks.
  - Login-walled or bot-blocking sites (LinkedIn, often Indeed pages) get a clear message and the paste fallback. No wall-bypassing.
  - The fetched page is untrusted: only the extracted spec reaches the editing agent, and the extracted text is shown before tailoring.
  - Tests: private IPs, redirects to private IPs, DNS rebinding, oversize; saved real-page fixtures for each extraction path.

## Phase 7: Import a CV from HTML, DOCX or PDF

Upload a file, get a CV in our JSON, reviewed before it is created.
- **Formats:** PDF (text or scanned; Gemini reads PDFs directly, so layout and scans work without a separate OCR step), DOCX (`python-docx`, text and structure), HTML (strip to text with structure). Legacy `.doc` is not supported directly; ask for a DOCX or PDF export. Size cap, file type checked by content and not just extension, files processed in memory and not kept.
- **Pipeline (a LangGraph run like the others):** `extract` (file to text or pages) -> `structure` (LLM returns the CV in our schema, validated by pydantic) -> `check` (flag fields that look wrong: dates out of order, empty sections, no name) -> review.
- **Review before creating:** show the parsed CV next to the original text with uncertain fields marked; you accept to create a new CV under a persona. Personal details are compared to the persona and you choose which to keep.
- **Safety:** the file is untrusted; the output is only ever data validated against the schema, never instructions.
- **Eval:** a golden set of real CVs with known JSON (we already have one hand-converted PDF, and can add more, including a DOCX and an HTML export of it). Metrics: fields recovered, wrong or invented values, dates.

## Order and why

5, then 6, then 7 as requested. Note that 7 is probably the feature you will use most (it gets existing CVs into the app) and 6 is the smallest (it reuses tailor). If you would rather have them sooner, either can move ahead of 5 without changing the others; memory benefits from having real imported CVs to learn from, so 7 before 5 is a reasonable swap.
