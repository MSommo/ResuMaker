# Roadmap

Phases 1 to 4 are done (versions and undo, dry run, streaming, review mode with a Postgres checkpointer, router, planner, parallel writers, critic, tailor to a job). Each phase below ships with its own tests and, where quality matters, a live eval.

## Phase 5: Memory (pgvector), done

Remember what is useful across sessions, per persona.
- **What is stored:** style preferences ("short bullets, no buzzwords"), facts you confirmed ("my title at Acme was Staff Engineer"), and the best bullets from past CVs. Always visible and editable in the UI, and removable one by one. Memory never overrides what is in the CV.
- **How:** a `memories` table (persona, kind, text, embedding `vector`, source CV, created) via an Alembic migration; the Postgres image becomes `pgvector/pgvector`. Embeddings from Gemini. The writers get the few most relevant memories as extra context.
- **Writes are explicit:** the assistant proposes "remember this?" and you accept; nothing is saved silently.
- **Eval:** does a remembered preference change the output, and does a wrong or stale memory ever beat the CV text (it must not).

## Phase 6: Bring a job posting in from a link (deferred)

Full design: **[phase-6-job-import.md](phase-6-job-import.md)**.

Summary: paste a link instead of the posting text, see what was read, then tailor as today. The built-in fetcher handles open pages only (schema.org `JobPosting` data first, then readable text, then optionally Chrome) behind strict server-side-request-forgery protection: validated and pinned addresses, hand-followed redirects, size and time caps, robots.txt, and a blocklist for sites that forbid automated access. Indeed has an official MCP server, best used **beside** ResuMaker's in Claude Code or Desktop rather than called from ResuMaker; LinkedIn has no official one and its community servers put your account at risk, so LinkedIn stays paste-only. Deferred on 2026-11-20.

## Phase 7: Import a CV from HTML, DOCX or PDF, done

Upload a file, get a CV in our JSON, reviewed before it is created.
- **Formats:** PDF (text or scanned; Gemini reads PDFs directly, so layout and scans work without a separate OCR step), DOCX (`python-docx`, text and structure), HTML (strip to text with structure). Legacy `.doc` is not supported directly; ask for a DOCX or PDF export. Size cap, file type checked by content and not just extension, files processed in memory and not kept.
- **Pipeline (a LangGraph run like the others):** `extract` (file to text or pages) -> `structure` (LLM returns the CV in our schema, validated by pydantic) -> `check` (flag fields that look wrong: dates out of order, empty sections, no name) -> review.
- **Review before creating:** show the parsed CV next to the original text with uncertain fields marked; you accept to create a new CV under a persona. Personal details are compared to the persona and you choose which to keep.
- **Safety:** the file is untrusted; the output is only ever data validated against the schema, never instructions.
- **Eval:** a golden set of real CVs with known JSON (we already have one hand-converted PDF, and can add more, including a DOCX and an HTML export of it). Metrics: fields recovered, wrong or invented values, dates.

## Order and why

5, then 6, then 7 as requested. Note that 7 is probably the feature you will use most (it gets existing CVs into the app) and 6 is the smallest (it reuses tailor). If you would rather have them sooner, either can move ahead of 5 without changing the others; memory benefits from having real imported CVs to learn from, so 7 before 5 is a reasonable swap.
