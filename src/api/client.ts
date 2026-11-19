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
}

export interface ChatResult {
  reply: string
  applied: string[]
  skipped: string[]
  messageId: string
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
export const chatHistory = (id: string) => json<ChatMessage[]>('GET', `/resumes/${id}/chat`)
export const clearChat = async (id: string) => void (await request('DELETE', `/resumes/${id}/chat`))

// PDF
export const pdf = async (id: string): Promise<Blob> => (await request('POST', `/resumes/${id}/pdf`)).blob()
