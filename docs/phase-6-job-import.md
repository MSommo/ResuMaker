# Phase 6: Bring a job posting in from a link (deferred)

Status: **designed, not built.** Deferred on 2026-11-20 in favour of finishing and freezing Phases 1 to 5 and 7.

Today "Tailor to a job" needs the posting's **text pasted** by hand. This phase lets you paste a **link** (or find the job in Indeed) instead, and feeds the same tailor flow. Everything after the text is unchanged: the posting is analysed against the CV, a variant CV is created, and you review the proposed changes.

## Goal and non-goals

Goals
- Paste a link to a job posting, see exactly what was read, edit it if needed, then tailor.
- Work well for open pages: company career sites and boards that publish their postings openly.
- Let Claude Code or Claude Desktop users find jobs on Indeed and hand them to ResuMaker, without ResuMaker scraping anything.

Non-goals
- No scraping of sites whose terms forbid automated access (LinkedIn, and by default Indeed and Glassdoor pages).
- No logging in to any site on your behalf, no cookies, no bypassing login walls, CAPTCHAs or bot detection.
- No job search or job alerts inside ResuMaker. Finding jobs is left to Indeed's own MCP server (below).
- ResuMaker's own server does not become an MCP client of Indeed or LinkedIn (see "Options considered").

## Options considered

| Option | Verdict | Why |
|---|---|---|
| **Indeed official MCP server** | Use it **at the client**, not inside ResuMaker | Indeed publishes an official MCP server (beta): hosted, searches jobs by title, keywords, location and employment type, signs you in with OAuth in a browser, and is subject to Indeed's Terms of Service. It is built for MCP clients like Claude. Add it next to the ResuMaker MCP and let the assistant call both. ResuMaker needs no Indeed code. |
| ResuMaker as an MCP **client** of Indeed | No | The OAuth sign-in is interactive and per person, which suits a desktop client and not a headless home server. It is also not confirmed that Indeed allows third-party apps to use it. Revisit only if Indeed offers app credentials. |
| **LinkedIn community MCP servers** | Not in ResuMaker | LinkedIn has no official MCP server. The community ones drive a logged-in browser session on your own account, which LinkedIn's terms prohibit (their READMEs say so). The risk lands on your account (restrictions or a ban). If you want one, use it at the client with a spare account and knowingly. |
| **Built-in "paste a link"** | Build it, for open pages only | Covers company career pages and many boards. Needs real SSRF protection because the server sits on your home network. |
| Paste the text (today) | Stays as the fallback | Always works, including for LinkedIn and Indeed postings. |

Facts about the Indeed server (endpoint `https://mcp.indeed.com/claude/mcp`, streamable HTTP, OAuth) come from search results and directory listings, not from Indeed's live docs page. **Check <https://docs.indeed.com/mcp> before relying on any detail**, including whether `claude mcp add indeed --transport http https://mcp.indeed.com/claude/mcp` is still the right command.

## What gets built

### 1. The fetcher (`backend/app/services/fetcher.py`)

One function, `fetch_posting(url) -> FetchedPosting`, built to be hard to misuse. The server runs next to Postgres, Redis and other containers, so a "fetch this URL" feature is a server-side request forgery (SSRF) risk by default.

**Address safety**
- Schemes `http` and `https` only. Ports 80 and 443 only. No user info in the URL (`http://user@host`).
- Resolve the hostname ourselves, collect **all** A and AAAA addresses, and refuse the request if **any** is loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16, which includes the cloud metadata address), carrier-grade NAT (100.64/10), unspecified, multicast, reserved, or an IPv4-mapped IPv6 form of one of those. Python's `ipaddress` properties (`is_global`) do the work; no hand-written ranges.
- Refuse names that never leave the machine or the Docker network: `localhost`, `*.local`, `*.internal`, `*.lan`, and single-label hosts such as `db`, `redis`, `api`, `host.docker.internal`.
- Refuse number-form hosts that bypass naive checks (decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.1`) by parsing with `ipaddress` after normalising, and by checking the resolved addresses anyway.
- **Pin the connection to the validated IP** (connect to the IP, send the original `Host`, use the hostname for TLS SNI and certificate checks). Resolving once and connecting to that exact IP defeats DNS rebinding, where a name answers "public" to the check and "127.0.0.1" to the connection.
- **Redirects are followed by hand**, at most 5, and every hop goes through the same checks (scheme, port, DNS, IP). A redirect to a private address is refused. Redirect loops are cut.

**Request limits**
- Total time 15 s (connect 5 s), response capped at 2 MB **after decompression** (a gzip bomb is cut off mid-stream), streamed, not loaded whole.
- Content types accepted: `text/html`, `application/xhtml+xml`, `text/plain`. Anything else (PDF, images, binaries) is refused with a clear message.
- No cookies, no stored credentials, no forwarded headers from your browser. A plain identifying user agent (`ResuMakerBot/1.0`) and `Accept-Language`.
- One page per request. No crawling and no following links in the page.
- **robots.txt:** fetched through the same checks and honoured for our user agent. If a site asks automated tools not to fetch the page, we say so and offer paste.
- **Hosts we do not touch by default** (configurable list `FETCH_BLOCKLIST`): `linkedin.com`, `indeed.*`, `glassdoor.*`. Their terms forbid automated access and their pages are login- or bot-gated anyway. The user gets: "This site doesn't allow automated reading. Paste the text, or use the Indeed MCP server."
- Per-client rate limit (extra to the existing AI limiter, for example 10 per minute) and a one-hour Redis cache keyed by the URL, so retries cost nothing and don't hit the site again.

**Extraction, in this order** (stop at the first that yields a real posting)
1. **schema.org `JobPosting` JSON-LD.** Many boards and career sites publish it for search engines. Read every `<script type="application/ld+json">`, handle arrays and `@graph`, take title, hiring organisation, description (HTML converted to text with the existing `html_to_text`), location, employment type, skills, qualifications, responsibilities, `datePosted` and `validThrough`. The most reliable source: structured, no guessing. An expired `validThrough` produces a warning.
2. **Readable text.** `trafilatura` (main-content extraction, headings and lists kept), falling back to the existing `html_to_text`. Title and company from `og:title`, `og:site_name` and `<title>` when there is no JSON-LD.
3. **Headless Chrome** (already in the API image for PDFs) for pages that render with JavaScript, used only when steps 1 and 2 give under about 400 characters of text. Every request the page makes is re-checked against the same address rules via Playwright route interception, images, fonts and media are blocked, and the whole thing has a 20 s limit. If this proves unreliable or too risky in practice, drop it: it is the only step that executes remote JavaScript.

**Block detection.** A 401, 403 or 429 response, a redirect to a path containing `login`, `signin`, `authwall` or `captcha`, or page text such as "sign in to view" or "verify you are human" produces a `blocked` result with a plain explanation and the paste fallback. We never try to get around it.

**Result**

```
FetchedPosting {
  url, finalUrl, title, company,
  text,                       # what the model will read, plain text with headings and lists
  source: "jsonld" | "readable" | "browser",
  warnings: [ "Posting may have expired (validThrough 2026-10-01)", ... ]
}
```

### 2. API

`POST /api/postings/fetch` with `{ "url": "https://..." }` returns a `FetchedPosting`, or an error with a user-facing message (`400` bad or forbidden address, `403` host not allowed or robots disallow, `422` nothing readable or login wall, `429` rate limit, `502` the site failed, `504` timeout). Rate-limited, requires the custom header like every unsafe call, and **saves nothing**.

The tailor endpoint is **unchanged**: it still takes `posting` text. Fetching and tailoring are separate steps on purpose, so the person sees and can edit what was read before it goes anywhere near the model.

### 3. UI (the Tailor dialog)

- The box becomes "Paste the job posting or a link to it". If the input is a single line starting with `http`, the primary button becomes **Read the page**.
- After reading: "Read from `example.com` (structured data)", the extracted text in the editable box, warnings in amber, then the usual **Tailor my CV**.
- Blocked or refused: the message, plus "Paste the text instead", and for Indeed and LinkedIn links a one-line hint about the Indeed MCP route.
- Same keyboard behaviour as the rest (Enter in the URL field reads the page, Esc closes).

### 4. MCP

- `fetch_posting(url)`: returns the same result, so a client can read a link and then call `tailor_to_posting`. Marked as not read-only (it makes a network request).
- A prompt `tailor_to_job(url_or_text, resume_id)` that spells out the flow, so it works with one click in clients that surface prompts.
- A short "Use with Indeed" section in the README: add the Indeed MCP server beside ResuMaker's, ask "find me backend jobs in London on Indeed, then tailor my CV to the second one", and the client calls Indeed's search, then `tailor_to_posting` with the posting text. No ResuMaker code beyond the prompt.

## Trust boundary (unchanged from pasted text)

A fetched page is **untrusted web content**, exactly like a pasted posting. Only the structured spec extracted by `analyze_posting` (summary, keywords, matched and gaps) reaches the editing agent, never the raw page. The extracted text is shown to the person before tailoring. Hidden text and scripts are stripped, and a test keeps a planted instruction in a page from ever reaching the writers.

## Tests

Unit tests with no network: fake resolver and fake transport injected into the fetcher (defaults are the real ones, so there are no test-only switches in production code).

- **SSRF table** (each must be refused with no request made): `127.0.0.1`, `[::1]`, `0.0.0.0`, `10.x`, `172.16.x`, `192.168.x`, `169.254.169.254`, `100.64.x`, `[::ffff:127.0.0.1]`, `2130706433`, `0177.0.0.1`, `0x7f.1`, `localhost`, `db`, `redis`, `host.docker.internal`, `http://user@evil.example`, ports 22 and 5432, schemes `file`, `ftp`, `gopher`, `data`.
- **DNS rebinding:** the resolver answers public first and private second; the request must connect to the first (pinned) address only.
- **Redirects:** to a private address, to a blocked scheme, a loop, more than 5 hops.
- **Limits:** oversize body, gzip bomb, slow body, wrong content type, robots.txt disallow, rate limit, cache hit makes no second request.
- **Extraction fixtures** (saved HTML, no network): JSON-LD (single, array, `@graph`, expired), a plain article, a JavaScript shell that needs the browser step, a login wall, a cookie-banner page, a non-English posting.
- **Blocklist:** `linkedin.com` and `indeed.com` get the friendly message without a request.
- **Injection:** a page with "ignore all previous instructions" in text and in hidden elements never reaches the agent.

**Live check** (`make eval-fetch`, opt-in): a small set of **real public posting URLs you choose** from boards you actually use, saved as fixtures when they are added. Scored on: title and company found, the requirements preserved in the text, and the right source chosen. Live pages change and disappear, so the fixtures are the regression suite and the live run is a smoke test.

## Work breakdown

1. Fetcher core with address safety, pinning, redirects and limits, plus the SSRF test table. **Do this first and review it hardest.** (M)
2. Extraction steps 1 and 2 with fixtures. (M)
3. Block detection, blocklist, robots.txt, cache and rate limit. (S)
4. Endpoint and MCP tool and prompt. (S)
5. Tailor dialog changes and a browser check. (S)
6. Chrome step 3, only if steps 1 and 2 miss too many real postings in the live check. (M, optional)
7. README "Use with Indeed" section, and `make eval-fetch`. (S)

## Open questions for when this is picked up

- Which job boards and career sites do you actually use? That decides the fixtures and whether step 3 (Chrome) is worth its added risk.
- Is the default blocklist right, or do you want Indeed pages attempted anyway (they usually fail on bot protection)?
- Should the fetched text be saved with the variant CV, for later reference? Today a tailored variant does not record which posting it was made for; that is a small, separate improvement.
- Re-check the Indeed MCP docs: availability, rate limits, whether it exposes a "get one posting" call (the search results only confirmed search), and its terms.

## Done when

- A public career-page link goes to a tailored variant in two steps (read, then tailor), with the text shown in between.
- Every address in the SSRF table is refused without a request.
- LinkedIn and Indeed links fail kindly with a working fallback, and the Indeed MCP flow is documented.
- `make test` is green with no network, and the frozen app has been rebuilt with `make stable-release`.
