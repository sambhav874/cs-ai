/**
 * Gotenberg client — HTML → PDF rendering.
 *
 * Used by A.5 (hybrid canonical artifact) to regenerate a PDF every time
 * the editor saves HTML, so signers/approvers always see the latest edits
 * in the PDF they're shown.
 *
 * Also reusable for export flows and future preview generation.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from './storage.js'

const GOTENBERG_URL = process.env.GOTENBERG_URL ?? 'http://localhost:3002'

// Wave 4 — when Gotenberg is deployed privately on Cloud Run (recommended;
// it has no built-in auth), service-to-service calls must carry an OIDC
// identity token whose audience is the Gotenberg URL. We fetch it from the
// Cloud Run metadata server and cache it (~1h TTL). Enabled by setting
// GOTENBERG_REQUIRE_AUTH=true on the API service in prod; off in local dev.
let _idTokenCache: { token: string; exp: number } | null = null

async function gotenbergAuthHeaders(): Promise<Record<string, string>> {
  if (process.env.GOTENBERG_REQUIRE_AUTH !== 'true') return {}
  const now = Date.now()
  if (_idTokenCache && _idTokenCache.exp > now + 60_000) {
    return { Authorization: `Bearer ${_idTokenCache.token}` }
  }
  const metaUrl =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'
    + `?audience=${encodeURIComponent(GOTENBERG_URL)}`
  const res = await fetch(metaUrl, { headers: { 'Metadata-Flavor': 'Google' } })
  if (!res.ok) {
    throw new Error(`Gotenberg OIDC token fetch failed (${res.status}) — the API must run on Cloud Run with a service account for private Gotenberg calls.`)
  }
  const token = (await res.text()).trim()
  let exp = now + 50 * 60_000 // default 50 min if the JWT can't be parsed
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (payload.exp) exp = payload.exp * 1000
  } catch { /* keep default TTL */ }
  _idTokenCache = { token, exp }
  return { Authorization: `Bearer ${token}` }
}

const DEFAULT_STYLES = `
  body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.6; margin: 2.5cm; color: #1a1a1a; }
  h1 { font-size: 18pt; margin-top: 1.2em; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; vertical-align: top; }
  ul, ol { padding-left: 1.5em; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
`

export interface RenderResult {
  s3Key: string
  size: number
}

function wrapHtml(html: string): string {
  if (html.trimStart().toLowerCase().startsWith('<!doctype')) return html
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${DEFAULT_STYLES}</style></head>
<body>${html}</body></html>`
}

/**
 * Render HTML to PDF and store in S3. Returns the S3 key.
 *
 * Throws on Gotenberg failure — callers should treat rendering as
 * best-effort (fire-and-forget) for editor saves so the save itself
 * doesn't fail if the PDF render is slow or the Gotenberg container
 * is temporarily down.
 */
export async function renderHtmlToPdfAndStore({
  html,
  keyPrefix,
  filename = 'contract.pdf',
}: {
  html: string
  /** S3 key prefix (e.g. `${orgId}/contracts/${contractId}/rendered`) */
  keyPrefix: string
  filename?: string
}): Promise<RenderResult> {
  if (!html?.trim()) throw new Error('renderHtmlToPdfAndStore: html is empty')

  const fullHtml = wrapHtml(html)
  const formData = new FormData()
  formData.append('files', new Blob([fullHtml], { type: 'text/html' }), 'index.html')

  const upstream = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
    method:  'POST',
    headers: await gotenbergAuthHeaders(),
    body:    formData,
  })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    throw new Error(`Gotenberg HTML→PDF failed (${upstream.status}): ${errText.slice(0, 200)}`)
  }

  const pdfBuffer = Buffer.from(await upstream.arrayBuffer())
  const key = `${keyPrefix.replace(/\/+$/, '')}/${Date.now()}-${filename}`

  await s3.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         key,
    Body:        pdfBuffer,
    ContentType: 'application/pdf',
  }))

  return { s3Key: key, size: pdfBuffer.length }
}
