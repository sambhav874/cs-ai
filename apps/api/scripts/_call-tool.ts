/**
 * Helper to call an internal /tools/:name endpoint with the
 * INTERNAL_SERVICE_SECRET header. Used by verify scripts that need to
 * hit tools directly without a user JWT.
 *
 * Usage:
 *   tsx _call-tool.ts <toolName> '<json-body>'
 *   → prints { status, body } on stdout
 */
// tsx --env-file=.env already hydrates process.env from .env at load
// time, so no explicit dotenv import is needed here.

const toolName = process.argv[2]
const bodyJson = process.argv[3]
if (!toolName || !bodyJson) {
  console.error('usage: _call-tool.ts <toolName> <json-body>')
  process.exit(1)
}
const secret = process.env.INTERNAL_SERVICE_SECRET
if (!secret) { console.error('INTERNAL_SERVICE_SECRET not set'); process.exit(1) }
const API = process.env.API_URL ?? 'http://localhost:3001'

const res = await fetch(`${API}/api/internal/ai/tools/${toolName}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-internal-service': 'agents',
    'x-internal-secret': secret,
  },
  body: bodyJson,
})
const text = await res.text()
let parsed: unknown = text
try { parsed = JSON.parse(text) } catch { /* leave as string */ }
console.log(JSON.stringify({ status: res.status, body: parsed }))
