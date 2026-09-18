/**
 * BYOK encryption helper (D.0.2)
 *
 * Used by /admin/ai/keys endpoints + the LangChain provider router
 * to round-trip API keys through the database safely.
 *
 * Algorithm: AES-256-GCM
 *   - 96-bit random nonce per encryption (NIST recommendation)
 *   - 128-bit authentication tag (catches tampering)
 *   - 256-bit master key from env (AI_KEY_ENCRYPTION_KEY, base64)
 *
 * Wire format (base64-encoded):
 *   v1.<base64(nonce || ciphertext || authTag)>
 *
 * Version prefix lets us add v2 (e.g., KMS-backed) later without
 * breaking existing rows.
 *
 * Operational notes:
 *   - The master key is loaded once at module init.
 *   - If AI_KEY_ENCRYPTION_KEY is not set, encrypt() throws — we
 *     refuse to silently store plaintext. Any code that tries to
 *     write a BYOK key without the env var will fail loudly.
 *   - Rotation: write a one-off re-encrypt script (read all,
 *     decrypt with old key, encrypt with new). Out of v1 scope.
 *
 * Generating a fresh master key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const NONCE_BYTES = 12  // 96-bit per NIST SP 800-38D
const TAG_BYTES = 16    // 128-bit GCM auth tag
const KEY_BYTES = 32    // AES-256
const VERSION = 'v1'

/**
 * Lazily load + validate the master key. Throws (loudly) if missing
 * or malformed so we never silently ship in an insecure config.
 */
function masterKey(): Buffer {
  const raw = process.env.AI_KEY_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'AI_KEY_ENCRYPTION_KEY is not set. Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n' +
      'Then set it in apps/api/.env (and keep the same value across all environments).'
    )
  }
  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('AI_KEY_ENCRYPTION_KEY is not valid base64')
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `AI_KEY_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
      'Generate a fresh one with the command in the comment of lib/encryption.ts'
    )
  }
  return key
}

/**
 * Encrypt a plaintext string for storage.
 * Returns a self-describing string: "v1.<base64(nonce||ct||tag)>"
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string')
  }
  const key = masterKey()
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGO, key, nonce)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const blob = Buffer.concat([nonce, ct, tag])
  return `${VERSION}.${blob.toString('base64')}`
}

/**
 * Decrypt a previously-encrypted string. Throws on:
 *   - unknown version prefix
 *   - tampered ciphertext (auth tag mismatch)
 *   - wrong master key
 */
export function decrypt(payload: string): string {
  if (typeof payload !== 'string') {
    throw new TypeError('decrypt() expects a string')
  }
  const [version, b64] = payload.split('.', 2)
  if (version !== VERSION) {
    throw new Error(`Unknown encryption version "${version}" — only "${VERSION}" supported`)
  }
  if (!b64) {
    throw new Error('Malformed encrypted payload — missing body')
  }
  const blob = Buffer.from(b64, 'base64')
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Malformed encrypted payload — too short')
  }
  const nonce = blob.subarray(0, NONCE_BYTES)
  const tag = blob.subarray(blob.length - TAG_BYTES)
  const ct = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES)

  const key = masterKey()
  const decipher = createDecipheriv(ALGO, key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/**
 * Extract a non-sensitive prefix for UI display (e.g., "sk-proj-").
 * Stored alongside the ciphertext on OrgAiKey.keyPrefix so the admin
 * can identify the key without us decrypting it on every list call.
 */
export function keyPrefix(plaintextKey: string, length = 8): string {
  if (typeof plaintextKey !== 'string') return ''
  return plaintextKey.slice(0, length)
}

/**
 * Sanity check that the env is configured. Call at startup so we crash
 * early rather than at first BYOK insert.
 */
export function assertEncryptionConfigured(): void {
  // Side-effect: throws if not configured
  masterKey()
}
