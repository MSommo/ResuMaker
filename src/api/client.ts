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
  title: string
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
  } catch {
    throw new ApiError('Can’t reach the ResuMaker API. Is it running? (npm run infra && npm run api)', 0)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data)
  }
  return res
}

const json = async <T,>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> => (await request(method, path, body, init)).json()

export const getCaps = async (): Promise<Caps> => {
  try {
    const j = await json<{ ai: boolean; pdf: boolean }>('GET', '/status')
    return { ai: !!j.ai, pdf: !!j.pdf }
  } catch {
    return { ai: false, pdf: false }
  }
}

// Personas (people who own CVs)
export const listPersonas = () => json<Persona[]>('GET', '/personas')
export const getPersona = (id: string) => json<{ persona: Persona; resumes: ResumeSummary[] }>('GET', `/personas/${id}`)
export const createPersona = (details: PersonalDetails) => json<Persona>('POST', '/personas', details)
export const updatePersona = (id: string, details: PersonalDetails) => json<Persona>('PUT', `/personas/${id}`, details)
export const deletePersona = async (id: string) => void (await request('DELETE', `/personas/${id}`))

// CVs
export const createResume = (personaId: string, body: { resume?: Resume; layoutId?: string; template?: 'blank' | 'sample' }) => json<ResumeDoc>('POST', `/personas/${personaId}/resumes`, body)
export const getResume = (id: string) => json<ResumeDoc>('GET', `/resumes/${id}`)
export const saveResume = (id: string, resume: Resume, version: number, keepalive = false) => json<ResumeDoc>('PUT', `/resumes/${id}`, { resume, version }, { keepalive })
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

/**
 * Streams one assistant turn as Server-Sent Events (a POST, so EventSource can't be used). Calls `onEvent` for every event
 * and resolves with the final `done` result, or with a `proposal` in review mode. Throws on an `error` event.
 */
export async function chatStream(id: string, message: string, mode: 'apply' | 'propose', onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<ChatResult | Proposal> {
  const res = await request('POST', `/resumes/${id}/chat/stream`, { message, mode }, { signal })
  if (!res.body) throw new ApiError('Streaming is not supported by this browser.', 0)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: ChatResult | Proposal | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, end).trim()
      buf = buf.slice(end + 2)
      if (!line.startsWith('data:')) continue
      const ev = JSON.parse(line.slice(5)) as ChatEvent
      onEvent(ev)
      if (ev.type === 'error') throw new ApiError(ev.message, ev.status)
      if (ev.type === 'done') result = ev.result
      if (ev.type === 'proposal') result = ev
    }
  }
  if (!result) throw new ApiError('The assistant stopped before finishing. Please try again.', 0)
  return result
}

export const decideProposal = (id: string, runId: string, accept: 'all' | 'none' | number[]) => json<ChatResult>('POST', `/resumes/${id}/chat/${runId}/decide`, { accept })
export const chatHistory = (id: string) => json<ChatMessage[]>('GET', `/resumes/${id}/chat`)
export const clearChat = async (id: string) => void (await request('DELETE', `/resumes/${id}/chat`))

// Version history
export const restoreVersion = (resumeId: string, versionId: string) => json<ResumeDoc>('POST', `/resumes/${resumeId}/versions/${versionId}/restore`)

// PDF
export const pdf = async (id: string): Promise<Blob> => (await request('POST', `/resumes/${id}/pdf`)).blob()
