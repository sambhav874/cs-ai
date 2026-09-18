/**
 * D.0.2 smoke — verify encryption round-trip + tamper detection +
 * env-required behaviour.
 */
import { encrypt, decrypt, keyPrefix, assertEncryptionConfigured } from '../src/lib/encryption.js'

let fail = 0
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.log(`  ✗ ${msg}`); fail++ }
}

// 1. Env configured?
try {
  assertEncryptionConfigured()
  console.log('  ✓ AI_KEY_ENCRYPTION_KEY env set + valid')
} catch (e) {
  console.log(`  ✗ env check failed: ${(e as Error).message}`)
  fail++
}

// 2. Round-trip a realistic OpenAI-style key
const sample = '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'
const ct1 = encrypt(sample)
const pt1 = decrypt(ct1)
check(pt1 === sample, 'round-trip recovers identical plaintext')
check(ct1.startsWith('v1.'), 'ciphertext carries version prefix')
check(ct1.length > sample.length, 'ciphertext is non-trivial')

// 3. Distinct ciphertexts for identical plaintext (nonce changes)
const ct2 = encrypt(sample)
check(ct1 !== ct2, 'two encrypts of the same plaintext yield different ciphertexts (nonce uniqueness)')
check(decrypt(ct2) === sample, 'second ciphertext also decrypts cleanly')

// 4. Tamper detection — flip a byte in the ciphertext body
const [v, body] = ct1.split('.', 2)
const buf = Buffer.from(body, 'base64')
buf[15] = buf[15] ^ 0xff
const tampered = `${v}.${buf.toString('base64')}`
let tamperCaught = false
try { decrypt(tampered) } catch { tamperCaught = true }
check(tamperCaught, 'tampered ciphertext throws (auth tag mismatch)')

// 5. Unknown version prefix is rejected
let versionCaught = false
try { decrypt('v999.junk') } catch { versionCaught = true }
check(versionCaught, 'unknown version prefix is rejected')

// 6. Malformed payload is rejected
let malformedCaught = false
try { decrypt('v1.tooshort') } catch { malformedCaught = true }
check(malformedCaught, 'too-short payload is rejected')

// 7. keyPrefix returns first chars
check(keyPrefix(sample, 8) === 'sk-proj-', 'keyPrefix returns first 8 chars')
check(keyPrefix('') === '', 'keyPrefix tolerates empty input')

// 8. Empty plaintext round-trips
const empty = encrypt('')
check(decrypt(empty) === '', 'empty plaintext round-trips')

// 9. Unicode + long content
const unicode = 'sk-' + '🔑✨'.repeat(50)
check(decrypt(encrypt(unicode)) === unicode, 'unicode + long content round-trips')

console.log()
if (fail) {
  console.log(`✗ ${fail} check(s) failed`)
  process.exit(1)
}
console.log('✓ All D.0.2 encryption checks pass')
