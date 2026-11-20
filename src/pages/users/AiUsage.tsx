import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getAiUsage, type AdminUser, type AiFeature, type AiUsageDetail, type AiUsageRecord, type AiUsageSummary } from '../../api/client'
import { timeAgo } from '../../model/relativeTime'

/*
 * AI use per person, on the admin Users page (issue #25). Everything here is counts and timings: the server never stores
 * what anyone asked the AI, so there is nothing else to show.
 */

export const FEATURE: Record<AiFeature, string> = { chat: 'Assistant', improve: 'Improve', tailor: 'Tailoring', import: 'CV import', memory: 'Memory' }
const INTENT: Record<string, string> = { edit: 'Edit', answer: 'Question', remember: 'Remember', off_topic: 'Off-topic' }
const REASON: Record<string, string> = {
  rate_limit: 'per-minute limit', daily_limit: 'daily limit', not_entitled: 'AI is off for this account',
  llm_error: 'AI service error', conflict: 'CV changed meanwhile', bad_input: 'unreadable file', error: 'server error', cancelled: 'stopped',
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
export const count = (n: number) => (n < 10_000 ? n.toLocaleString() : compact.format(n))
export const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : `$${n.toFixed(n < 10 ? 2 : 0)}`)
const pct = (x: number) => `${Math.round(x * 100)}%`
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** How close someone is to the daily limit: "over" at the limit, "near" from 80%. */
export type LimitState = 'ok' | 'near' | 'over'
export function limitState(u: AiUsageSummary | null | undefined): LimitState {
  if (!u || !u.dailyLimit) return 'ok'
  const r = u.today / u.dailyLimit
  return r >= 1 ? 'over' : r >= 0.8 ? 'near' : 'ok'
}
export const hasUsage = (u: AiUsageSummary | null | undefined) => !!u && (u.month > 0 || u.rejected > 0 || !!u.lastUsedAt)

/** The row's cell: today against the limit, the last 30 days underneath. A button that opens the detail. */
export function UsageCell({ user, open, onToggle }: { user: AdminUser; open: boolean; onToggle: () => void }) {
  const u = user.aiUsage
  if (!hasUsage(u)) return <small>Not used</small>
  const s = u!
  const state = limitState(s)
  return (
    <button type="button" className={`usage-cell l-${state}`} aria-expanded={open} aria-controls={`usage-${user.id}`} onClick={onToggle}>
      <span className="usage-today">
        <strong>{count(s.today)}</strong>{s.dailyLimit ? <span className="usage-limit"> / {count(s.dailyLimit)}</span> : null} today
        {state !== 'ok' && <span className={`limit-badge l-${state}`}>{state === 'over' ? 'At limit' : 'Near limit'}</span>}
      </span>
      <small>{count(s.month)} in 30 days · {usd(s.costUsd)}{s.rejected ? ` · ${count(s.rejected)} refused` : ''}</small>
    </button>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="usage-stat" title={hint}><dt>{label}</dt><dd>{value}</dd></div>
}

/** The detail under a row: the last 30 days, per day, per feature, per model, and the latest requests. */
export function UsageDetail({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [data, setData] = useState<AiUsageDetail | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    setError('')
    getAiUsage(user.id, ctl.signal).then(setData).catch((e) => {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.')
    })
    return () => ctl.abort()
  }, [user.id, attempt])

  const name = user.firstName || 'this person'
  return (
    <section id={`usage-${user.id}`} className="usage-detail" aria-label={`AI use by ${name}, last 30 days`} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="usage-detail-head">
        <h3>AI use by {name} <small>last 30 days</small></h3>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
      {error ? (
        <p className="form-error" role="alert">{error} <button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>
      ) : !data ? (
        <p className="muted" aria-busy="true">Loading…</p>
      ) : (
        <DetailBody d={data} />
      )}
      <p className="usage-note">Only counts and timings are kept, and only for a limited time (90 days unless configured otherwise): never what anyone typed, their CV, or the AI’s replies. Costs are estimates.</p>
    </section>
  )
}

const RECENT_FIRST = 10

function DetailBody({ d }: { d: AiUsageDetail }) {
  const s = d.summary
  const [allRecent, setAllRecent] = useState(false)
  const recent = allRecent ? d.recent : d.recent.slice(0, RECENT_FIRST)
  const failed = d.recent.filter((r) => r.status !== 'ok').length
  return (
    <>
      <dl className="usage-stats">
        <Stat label="Requests" value={count(s.month)} hint="Refused attempts not included" />
        <Stat label="Today" value={s.dailyLimit ? `${count(s.today)} / ${count(s.dailyLimit)}` : count(s.today)} hint="UTC day, like the daily limit" />
        <Stat label="Tokens" value={count(s.tokens)} />
        <Stat label="Est. cost" value={usd(s.costUsd)} hint={d.pricesConfigured ? 'From the configured model prices' : 'A model used has no price configured: it counts as $0'} />
        <Stat label="Failed" value={count(s.errors)} />
        <Stat label="Refused" value={count(s.rejected)} hint="Over a limit, or AI off for the account" />
        <Stat label="Off-topic" value={s.offTopicShare === null ? '–' : pct(s.offTopicShare)} hint="Share of assistant messages unrelated to the CV" />
        <Stat label="Last used" value={s.lastUsedAt ? timeAgo(s.lastUsedAt) : 'Never'} />
      </dl>
      <UsageChart d={d} />
      <div className="usage-tables">
        <table className="mini-table">
          <caption>By feature</caption>
          <thead><tr><th>Feature</th><th className="num">Requests</th><th className="num">Tokens</th><th className="num">Cost</th><th className="num">Failed / refused</th></tr></thead>
          <tbody>
            {d.byFeature.length ? d.byFeature.map((f) => (
              <tr key={f.feature}><td>{FEATURE[f.feature] ?? f.feature}</td><td className="num">{count(f.requests)}</td><td className="num">{count(f.tokens)}</td><td className="num">{usd(f.cost)}</td><td className="num">{f.errors + f.rejected || '–'}</td></tr>
            )) : <tr><td colSpan={5} className="muted">Nothing in this period.</td></tr>}
          </tbody>
        </table>
        <table className="mini-table">
          <caption>By model</caption>
          <thead><tr><th>Model</th><th className="num">Calls</th><th className="num">In</th><th className="num">Out</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {d.byModel.length ? d.byModel.map((m) => (
              <tr key={m.model}><td><code>{m.model}</code></td><td className="num">{count(m.calls)}{m.errors ? <small> ({m.errors} failed)</small> : null}</td><td className="num">{count(m.inputTokens)}</td><td className="num">{count(m.outputTokens)}</td><td className="num">{usd(m.cost)}</td></tr>
            )) : <tr><td colSpan={5} className="muted">No model calls in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="mini-table recent">
          <caption>Latest requests{failed ? ` (${failed} not OK)` : ''}</caption>
          <thead><tr><th>When</th><th>What</th><th>Outcome</th><th>Model</th><th className="num">Tokens</th><th className="num">Time</th><th className="num">Changes</th></tr></thead>
          <tbody>
            {recent.length ? recent.map((r) => <RecentRow key={r.id} r={r} />) : <tr><td colSpan={7} className="muted">No requests yet.</td></tr>}
          </tbody>
        </table>
        {d.recent.length > RECENT_FIRST && (
          <button type="button" className="btn small recent-more" onClick={() => setAllRecent(!allRecent)}>
            {allRecent ? `Show the latest ${RECENT_FIRST}` : `Show all ${d.recent.length}`}
          </button>
        )}
      </div>
    </>
  )
}

function RecentRow({ r }: { r: AiUsageRecord }) {
  const outcome = r.status === 'ok' ? 'OK' : r.status === 'rejected' ? 'Refused' : r.status === 'cancelled' ? 'Stopped' : 'Failed'
  const changes = [r.opsApplied && `${r.opsApplied} applied`, r.opsRejected && `${r.opsRejected} rejected`, r.guardRejections && `${r.guardRejections} blocked by the contact guard`].filter(Boolean).join(', ')
  return (
    <tr className={r.status === 'ok' ? undefined : `not-ok s-${r.status}`}>
      <td><time dateTime={r.at} title={new Date(r.at).toLocaleString()}>{timeAgo(r.at)}</time></td>
      <td>{FEATURE[r.feature] ?? r.feature}{r.intent ? <small> · {INTENT[r.intent] ?? r.intent}</small> : null}{r.source === 'mcp' ? <small> · via MCP</small> : null}</td>
      <td><span className={`outcome o-${r.status}`}>{outcome}</span>{r.reason && r.status !== 'cancelled' ? <small> · {REASON[r.reason] ?? r.reason}</small> : null}</td>
      <td>{r.model ? <code>{r.model}</code> : '–'}</td>
      <td className="num">{r.inputTokens + r.outputTokens ? count(r.inputTokens + r.outputTokens) : '–'}</td>
      <td className="num">{r.status === 'rejected' ? '–' : r.latencyMs < 1000 ? `${r.latencyMs} ms` : `${(r.latencyMs / 1000).toFixed(1)} s`}</td>
      <td className="num" title={r.requestId ? `Request id ${r.requestId}` : undefined}>{changes || '–'}</td>
    </tr>
  )
}

// ---------------------------------------------------------------- the chart

type Day = { day: string; done: number; bad: number; requests: number; errors: number; rejected: number; tokens: number; cost: number }

/** Every UTC day of the range, including the quiet ones (a gap must look like a gap, not be skipped). */
function days(d: AiUsageDetail): Day[] {
  const byDay = new Map(d.series.map((x) => [x.day, x]))
  const out: Day[] = []
  const end = new Date(d.end)
  for (let t = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - 29 * 86_400_000; out.length < 30; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10)
    const x = byDay.get(key)
    const errors = x?.errors ?? 0
    const rejected = x?.rejected ?? 0
    const requests = x?.requests ?? 0
    out.push({ day: key, requests, errors, rejected, done: Math.max(0, requests - errors), bad: errors + rejected, tokens: x?.tokens ?? 0, cost: x?.cost ?? 0 })
  }
  return out
}

function niceMax(n: number) {
  if (n <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(n))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= n)!
}

/** A column from the baseline with a 4px rounded top (square at the bottom). */
function column(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`
}

const H = 150
const PAD = { top: 10, right: 8, bottom: 22, left: 34 }

/** The box's width in CSS pixels, kept up to date: the chart is drawn at its real size, so text never scales with it. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)))
    ro.observe(el)
    setW(Math.max(240, el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function UsageChart({ d }: { d: AiUsageDetail }) {
  const data = useMemo(() => days(d), [d])
  const [hover, setHover] = useState<number | null>(null)
  const [box, W] = useWidth(640)
  const top = niceMax(Math.max(...data.map((x) => x.done + x.bad)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / data.length
  const barW = Math.min(14, slot - 2) // thin, with air between days
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH
  const anyBad = data.some((x) => x.bad > 0)
  const h = hover !== null ? data[hover] : null

  return (
    <figure className="usage-chart">
      <figcaption>
        <span>Requests per day (UTC)</span>
        <span className="chart-legend" aria-hidden="true">
          <span><i className="sw sw-done" /> Completed</span>
          {anyBad && <span><i className="sw sw-bad" /> Failed or refused</span>}
        </span>
      </figcaption>
      <div className="chart-box" ref={box} onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Requests per day for the last 30 days; at most ${Math.max(...data.map((x) => x.done + x.bad))} in a day. The table below has every value.`}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{count(t)}</text>
            </g>
          ))}
          {data.map((x, i) => {
            const cx = PAD.left + i * slot + (slot - barW) / 2
            const doneH = (x.done / top) * plotH
            const badH = (x.bad / top) * plotH
            const gap = x.done && x.bad ? 2 : 0 // surface gap between the two segments
            return (
              <g key={x.day} className={hover === i ? 'day on' : 'day'}>
                {x.done > 0 && <path d={column(cx, y(x.done), barW, doneH, x.bad === 0)} className="bar-done" />}
                {x.bad > 0 && <path d={column(cx, y(x.done) - gap - badH, barW, badH, true)} className="bar-bad" />}
                {/* the hit target: the whole day's column, not just the (possibly tiny) bar */}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} className="hit" onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          {[0, 14, 29].map((i) => (
            <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor={i === 0 ? 'start' : i === 29 ? 'end' : 'middle'} className="tick">{day(data[i].day)}</text>
          ))}
        </svg>
        {h && (
          // Centred on its day, except near either edge, where it opens inwards instead of running off the chart.
          <div className="chart-tip" role="status" style={{
            left: PAD.left + hover! * slot + slot / 2,
            transform: hover! < 4 ? 'translateX(-12px)' : hover! > data.length - 5 ? 'translateX(calc(-100% + 12px))' : 'translateX(-50%)',
          }}>
            <strong>{day(h.day)}</strong>
            <span>{h.requests} request{h.requests === 1 ? '' : 's'}{h.errors ? `, ${h.errors} failed` : ''}</span>
            {h.rejected > 0 && <span>{h.rejected} refused</span>}
            {h.tokens > 0 && <span>{count(h.tokens)} tokens · {usd(h.cost)}</span>}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <table className="mini-table">
          <thead><tr><th>Day</th><th className="num">Requests</th><th className="num">Failed</th><th className="num">Refused</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
          <tbody>{data.filter((x) => x.requests || x.rejected).map((x) => (
            <tr key={x.day}><td>{day(x.day)}</td><td className="num">{x.requests}</td><td className="num">{x.errors}</td><td className="num">{x.rejected}</td><td className="num">{count(x.tokens)}</td><td className="num">{usd(x.cost)}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </figure>
  )
}
