/**
 * Lightweight telemetry — B.5.17.
 *
 * Emits product-analytics events without coupling us to any vendor SDK.
 * In development it logs to the console so engineers can see what's
 * being tracked; in production it POSTs to /api/v1/telemetry/events
 * (stub endpoint not required for V1 — the body is just serialised and
 * held in a buffered sender that drops on unload).
 *
 * Usage:
 *   track('palette_opened', { from: 'header' })
 *   track('compare_opened', { versionCount: 5 })
 *
 * The data shape intentionally stays simple. We're NOT tracking:
 *   - Contract titles, counterparty names, clause text, user emails,
 *     risk scores, document content, or anything else that could re-
 *     identify a deal. If you find yourself wanting to log one of
 *     those, the fix is almost always "count it" (how many clauses)
 *     not "send it" (which clauses).
 *
 * Event names are lowercase_snake_case so they group cleanly in any
 * analytics backend.
 */

type EventProps = Record<string, string | number | boolean | null>

const buffer: Array<{ event: string; props: EventProps; at: number }> = []
let sendTimer: ReturnType<typeof setTimeout> | null = null

function flush() {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  // Dev-mode visibility. `import.meta.env` typing varies across bundlers,
  // so we gate on a cheap runtime check: Vite sets NODE_ENV to development
  // when you run `vite dev`, and exposes a hostname we can sniff if not.
  const isDev = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)
  if (isDev) {
    // Show the batch in the console for engineer visibility during V1 dev.
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', batch)
    return
  }
  // Production: fire-and-forget POST. Errors here should never affect UI.
  const body = JSON.stringify({ events: batch })
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/v1/telemetry/events', blob)
    } else {
      fetch('/api/v1/telemetry/events', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        body,
        keepalive:   true,
      }).catch(() => { /* drop — telemetry is best-effort */ })
    }
  } catch {
    // Swallow — telemetry is strictly best-effort.
  }
}

/**
 * Record a named event with optional properties. Safe to call from
 * anywhere — if called outside a browser environment it no-ops.
 */
export function track(event: string, props: EventProps = {}) {
  if (typeof window === 'undefined') return
  buffer.push({ event, props, at: Date.now() })
  if (sendTimer) clearTimeout(sendTimer)
  sendTimer = setTimeout(flush, 2000)
}

if (typeof window !== 'undefined') {
  // Make sure buffered events escape on navigation / tab close.
  window.addEventListener('beforeunload', flush)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
