import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '../api/client'

/**
 * Browser errors go to our own API (POST /api/telemetry/client-errors), which logs them and, if configured, forwards
 * them to the error tracker. The browser never talks to a third party, so the CSP stays `connect-src 'self'`.
 * What is sent: the error message, its stack (code locations) and the page path. No CV content, no query strings.
 */
const MAX_PER_PAGE = 10 // an error in a render loop must not turn into a flood (the server caps per minute too)
let sent = 0
const seen = new Set<string>()

export function report(error: unknown, extraStack = '') {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown')
  const key = `${e.name}: ${e.message}`
  if (sent >= MAX_PER_PAGE || seen.has(key)) return
  seen.add(key)
  sent += 1
  void reportClientError({
    message: key.slice(0, 1000),
    stack: `${e.stack ?? ''}${extraStack}`.slice(0, 8000),
    path: window.location.pathname,
    release: import.meta.env.VITE_RELEASE ?? '',
  })
}

/** Uncaught errors and unhandled promise rejections, anywhere on the page. Call once, at start. */
export function installErrorReporting() {
  window.addEventListener('error', (ev) => report(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => {
    if (ev.reason instanceof DOMException && ev.reason.name === 'AbortError') return // a request cancelled on purpose
    report(ev.reason)
  })
}

/** A crash while drawing the page shows a way out instead of a blank screen, and is reported. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    report(error, `\n[component stack]${info.componentStack ?? ''}`)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="container page">
        <div className="state-box" role="alert">
          <h2>Something went wrong</h2>
          <p>This page hit an error and couldn’t be shown. Your saved work is safe. The error has been reported.</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </div>
    )
  }
}
