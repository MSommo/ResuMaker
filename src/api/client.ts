import type { PersonalDetails, Resume } from '../model/types'

export interface Caps {
  ai: boolean
  pdf: boolean
}

export interface Persona extends PersonalDetails {
  id: string
  resumeCount: number
  createdAt: string
  updatedAt: string
}

export interface ResumeSummary {
  id: string
  personaId: string
  /** What to show for the CV: its name, else its headline, else "Untitled CV". */
  title: string
  /** The owner's own label for telling CVs apart; never printed on the CV. "" when there is none. */
  name: string
  /** Printed under the person's name on the CV. */
  headline: string
  layoutId: string
  version: number
  updatedAt: string
}

export interface ResumeDoc extends ResumeSummary {
  createdAt: string
  persona: Persona
  /** Complete CV: the persona's details are merged into `basics`. */
  resume: Resume
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  applied: string[]
  skipped: string[]
  /** Snapshot taken just before this message's changes: restoring it is "Undo". */
  undoVersionId: string | null
  undone: boolean
}

export interface ChatResult {
  reply: string
  applied: string[]
  skipped: string[]
  /** Readable summary of what changed in the CV. */
  changes: string[]
  messageId: string
  undoVersionId: string | null
  /** What the assistant did with the message. */
  intent?: 'edit' | 'answer' | 'remember'
  resume: ResumeDoc
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) {
    super(message)
  }
}

/**
 * Talks to the FastAPI backend (proxied at /api). Unsafe methods carry a custom header, which the server requires:
 * cross-site pages can't send it without a CORS preflight that the server only grants to our own origin.
 */
async function request(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-resumaker': '1' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    })
  } catch (e) {
    if (init.signal?.aborted) throw e // cancelled on purpose (AbortError), not a network problem
    throw new ApiError('Can’t reach the ResuMaker API. Is it running? (npm run infra && npm run api)', 0)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    notifyIfSignedOut(path, res.status)
    notifyIfAiRevoked(res.status, data?.error)
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data)
  }
  return res
}

/** A 401 anywhere (session expired, ended elsewhere, user disabled) sends the app back to the sign-in page. Sign-in's own 401 is just "wrong password". */
/** An administrator turned AI off for this account while it was signed in: the server refused an AI request. */
export const AI_REVOKED = 'resumaker:ai-revoked'
function notifyIfAiRevoked(status: number, message: unknown) {
  if (status === 403 && typeof message === 'string' && message.startsWith("AI features aren't included") /* the server's AI_NOT_INCLUDED */) window.dispatchEvent(new Event(AI_REVOKED))
}

export const UNAUTHORIZED = 'resumaker:unauthorized'
function notifyIfSignedOut(path: string, status: number) {
  if (status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/accept')) window.dispatchEvent(new Event(UNAUTHORIZED))
}

const json = async <T,>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> => (await request(method, path, body, init)).json()

/** What the server can do, or null if it couldn't be asked (it may be restarting): "unknown" is not "no AI". */
export const getCaps = async (): Promise<Caps | null> => {
  try {
    const j = await json<{ ai: boolean; pdf: boolean }>('GET', '/status')
    return { ai: !!j.ai, pdf: !!j.pdf }
  } catch {
    return null
  }
}

// Accounts. The session is an HttpOnly cookie the browser sends by itself: this code never sees or stores a credential.
export type Role = 'user' | 'admin'
export interface Me {
  login: string
  role: Role
  /** This account may use the AI features (the server must also have AI: see Caps). */
  ai: boolean
  persona: Persona
}
export const getMe = () => json<Me>('GET', '/auth/me')
export const signIn = (login: string, password: string) => json<Me>('POST', '/auth/login', { login, password })
export const signOut = async () => void (await request('POST', '/auth/logout'))
export const acceptInvite = (token: string, password: string) => json<Me>('POST', '/auth/accept', { token, password })
export const changePassword = async (current: string, next: string) => void (await request('POST', '/auth/password', { current, new: next }))
export const signOutEverywhere = async () => void (await request('POST', '/auth/logout-all'))
export const deleteAccount = async (password: string) => void (await request('POST', '/account/delete', { password }))

// Administration (admins manage accounts; they cannot open anyone's CVs)
export interface AdminUser {
  id: string
  login: string | null
  firstName: string
  lastName: string
  role: Role
  isActive: boolean
  /** The stored flag; administrators have AI regardless. */
  aiEnabled: boolean
  status: 'draft' | 'invited' | 'active' | 'locked' | 'disabled'
  resumeCount: number
  lastLoginAt: string | null
  createdAt: string
  /** Counts only: the server never stores what anyone asked the AI. Absent on older servers. */
  aiUsage?: AiUsageSummary | null
}
/** One person's AI use. "Requests" leave out refused attempts (rate limit, daily limit, no AI), counted in `rejected`. */
export interface AiUsageSummary {
  /** Today, as a UTC day: the same day the daily limit counts. */
  today: number
  week: number
  /** The last 30 days, like every field below. */
  month: number
  tokens: number
  /** Estimated, from the server's AI_PRICES. */
  costUsd: number
  errors: number
  rejected: number
  /** Share of chat turns the router judged unrelated to the CV; null = no chat yet. */
  offTopicShare: number | null
  lastUsedAt: string | null
  /** AI requests per person per day; 0 = unlimited. */
  dailyLimit: number
}
export type AiFeature = 'chat' | 'improve' | 'tailor' | 'import' | 'memory'
export interface AiUsageRecord {
  id: string
  at: string
  feature: AiFeature
  source: 'web' | 'mcp'
  intent: 'edit' | 'answer' | 'remember' | 'off_topic' | null
  status: 'ok' | 'error' | 'rejected' | 'cancelled'
  reason: string | null
  model: string | null
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  opsApplied: number
  opsRejected: number
  guardRejections: number
  requestId: string | null
}
export interface AiUsageDetail {
  userId: string
  start: string
  end: string
  summary: AiUsageSummary
  series: { day: string; requests: number; tokens: number; cost: number; errors: number; rejected: number }[]
  byFeature: { feature: AiFeature; requests: number; tokens: number; cost: number; errors: number; rejected: number }[]
  byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; errors: number; cost: number }[]
  recent: AiUsageRecord[]
  /** False when a model used has no price configured: its cost reads 0. */
  pricesConfigured: boolean
}
export const getAiUsage = (id: string, signal?: AbortSignal) => json<AiUsageDetail>('GET', `/admin/users/${id}/ai-usage`, undefined, { signal })

/** A JavaScript error, for the server's logs (and its error tracker, if configured). Never throws: reporting must not cause errors. */
export const reportClientError = (body: { message: string; stack?: string; path: string; release?: string }) =>
  fetch('/api/telemetry/client-errors', { method: 'POST', headers: { 'content-type': 'application/json', 'x-resumaker': '1' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined)

export interface Invite {
  user: AdminUser
  link: string
  expiresInHours: number
}
export const listUsers = () => json<AdminUser[]>('GET', '/admin/users')
/** Prepare a persona: a name and the email they will sign in with. No password, no link yet. */
export const createDraft = (body: { firstName: string; lastName: string; login: string; role: Role }) => json<AdminUser>('POST', '/admin/users', body)
export const patchUser = (id: string, body: { role?: Role; isActive?: boolean; login?: string; aiEnabled?: boolean }) => json<AdminUser>('PATCH', `/admin/users/${id}`, body)
export const reissueInvite = (id: string) => json<Invite>('POST', `/admin/users/${id}/invite`)
export const signUserOut = async (id: string) => void (await request('POST', `/admin/users/${id}/sign-out`))
export const deleteUser = async (id: string, password: string) => void (await request('POST', `/admin/users/${id}/delete`, { password }))

// Your profile and CVs
export const getPersona = (id: string) => json<{ persona: Persona; resumes: ResumeSummary[] }>('GET', `/personas/${id}`)
export const updatePersona = (id: string, details: PersonalDetails) => json<Persona>('PUT', `/personas/${id}`, details)

// CVs
export const createResume = (personaId: string, body: { resume?: Resume; layoutId?: string; template?: 'blank' | 'sample'; name?: string }) => json<ResumeDoc>('POST', `/personas/${personaId}/resumes`, body)
export const getResume = (id: string) => json<ResumeDoc>('GET', `/resumes/${id}`)
export const saveResume = (id: string, resume: Resume, version: number, keepalive = false) => json<ResumeDoc>('PUT', `/resumes/${id}`, { resume, version }, { keepalive })
/** Name a CV ("" clears it). Not a content change: the version stays, so an open editor isn't affected. */
export const renameResume = (id: string, name: string) => json<ResumeSummary>('PATCH', `/resumes/${id}`, { name })
export const deleteResume = async (id: string) => void (await request('DELETE', `/resumes/${id}`))

// AI
export const improve = (body: { kind: string; text: string; instruction?: string; context?: object }) => json<{ text: string; cached: boolean }>('POST', '/ai/improve', body)
export const chat = (id: string, message: string) => json<ChatResult>('POST', `/resumes/${id}/chat`, { message })
/** Changes the assistant proposes in review mode; nothing is applied until `decideProposal`. */
export interface Proposal {
  runId: string
  reply: string
  items: { index: number; summary: string }[]
  skipped: string[]
  changes: string[]
}

export type ChatEvent =
  | { type: 'status'; label: string }
  | { type: 'step'; node: string; detail: string }
  | { type: 'proposal' } & Proposal
  | { type: 'done'; result: ChatResult }
  | { type: 'error'; status: number; message: string }

const throwError = (ev: { status: number; message: string }): never => {
  throw new ApiError(ev.message, ev.status)
}

/** Reads a Server-Sent Events response (we POST, so EventSource can't be used) and calls `onEvent` for each event. */
async function readEvents<E extends { type: string }>(res: Response, onEvent: (e: E) => void): Promise<void> {
  if (!res.body) throw new ApiError('Streaming is not supported by this browser.', 0)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, end).trim()
      buf = buf.slice(end + 2)
      if (line.startsWith('data:')) onEvent(JSON.parse(line.slice(5)) as E)
    }
  }
}

/**
 * Streams one assistant turn. Resolves with the final `done` result, or with a `proposal` in review mode. Throws on an `error` event.
 */
export async function chatStream(id: string, message: string, mode: 'apply' | 'propose', onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<ChatResult | Proposal> {
  const res = await request('POST', `/resumes/${id}/chat/stream`, { message, mode }, { signal })
  let result: ChatResult | Proposal | null = null
  await readEvents<ChatEvent>(res, (ev) => {
    onEvent(ev)
    if (ev.type === 'error') (notifyIfAiRevoked(ev.status, ev.message), throwError(ev))
    if (ev.type === 'done') result = ev.result
    if (ev.type === 'proposal') result = ev
  })
  if (!result) throw new ApiError('The assistant stopped before finishing. Please try again.', 0)
  return result
}

/** What a job posting needs, and how the CV measures up. */
export interface JobSpec {
  title: string
  company: string
  summary: string
  keywords: string[]
  matched: string[]
  gaps: string[]
  language: string
}

export type TailorEvent =
  | { type: 'status'; label: string }
  | { type: 'step'; node: string; detail: string }
  | { type: 'spec' } & JobSpec
  | { type: 'variant'; resumeId: string; personaId: string }
  | { type: 'proposal'; resumeId: string } & Proposal
  | { type: 'error'; status: number; message: string }

/** Tailors a CV to a pasted posting: creates a variant CV and resolves with the proposal to review (nothing is applied yet). */
export async function tailorStream(id: string, posting: string, onEvent: (e: TailorEvent) => void, signal?: AbortSignal): Promise<Proposal & { resumeId: string }> {
  const res = await request('POST', `/resumes/${id}/tailor/stream`, { posting }, { signal })
  let result: (Proposal & { resumeId: string }) | null = null
  await readEvents<TailorEvent>(res, (ev) => {
    onEvent(ev)
    if (ev.type === 'error') (notifyIfAiRevoked(ev.status, ev.message), throwError(ev))
    if (ev.type === 'proposal') result = ev
  })
  if (!result) throw new ApiError('Tailoring stopped before finishing. Please try again.', 0)
  return result
}

export const decideProposal = (id: string, runId: string, accept: 'all' | 'none' | number[]) => json<ChatResult>('POST', `/resumes/${id}/chat/${runId}/decide`, { accept })
export const chatHistory = (id: string) => json<ChatMessage[]>('GET', `/resumes/${id}/chat`)
export const clearChat = async (id: string) => void (await request('DELETE', `/resumes/${id}/chat`))

/** A CV read from a file. Nothing is saved: review it, then create it with `createResume(personaId, { resume })`. */
export interface ImportPreview {
  resume: Resume
  kind: 'pdf' | 'docx' | 'html'
  language: string
  warnings: string[]
  stats: Record<string, number>
}
export async function importCv(personaId: string, file: File, signal?: AbortSignal): Promise<ImportPreview> {
  const body = new FormData()
  body.append('file', file)
  let res: Response
  try {
    // No content-type header: the browser adds the multipart boundary itself.
    res = await fetch(`/api/personas/${personaId}/imports/cv`, { method: 'POST', headers: { 'x-resumaker': '1' }, body, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Can’t reach the ResuMaker API.', 0)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    notifyIfSignedOut('/imports', res.status)
    throw new ApiError(data?.error ?? `Import failed (${res.status})`, res.status, data)
  }
  return res.json()
}

// Memory: what the assistant remembers about a person (preferences and facts they confirmed)
export interface Memory {
  id: string
  kind: 'preference' | 'fact'
  text: string
  createdAt: string
}
export const listMemories = (personaId: string) => json<Memory[]>('GET', `/personas/${personaId}/memories`)
export const addMemory = (personaId: string, kind: Memory['kind'], text: string) => json<Memory>('POST', `/personas/${personaId}/memories`, { kind, text })
export const deleteMemory = async (id: string) => void (await request('DELETE', `/memories/${id}`))

// Version history
export const restoreVersion = (resumeId: string, versionId: string) => json<ResumeDoc>('POST', `/resumes/${resumeId}/versions/${versionId}/restore`)

// PDF
export const pdf = async (id: string): Promise<Blob> => (await request('POST', `/resumes/${id}/pdf`)).blob()
