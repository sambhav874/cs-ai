/**
 * Generate a PKCS#12 signing certificate for sealing executed contracts, and
 * print the two environment variables that carry it.
 *
 *   pnpm --filter api signing-cert -- "Acme Legal" "Acme Inc"
 *
 * The cert is self-signed: signatures verify cryptographically and any later
 * byte change breaks them, but a PDF reader shows the signer as untrusted
 * until the cert is trusted or replaced by a CA-issued one. Store the output
 * as secrets (Coolify env, Secret Manager) — never commit it.
 */
import crypto from 'node:crypto'
import { generateSelfSignedP12 } from '../src/lib/signing-cert.js'

const [commonName = 'Contract Signing Authority', orgName = 'ContractSense'] = process.argv.slice(2).filter(a => a !== '--')
const passphrase = crypto.randomBytes(24).toString('base64url')
const p12 = generateSelfSignedP12(passphrase, commonName, orgName)

process.stdout.write(`SIGNING_CERT_P12_BASE64=${p12.toString('base64')}\n`)
process.stdout.write(`SIGNING_CERT_PASSPHRASE=${passphrase}\n`)
process.stderr.write(`\nSelf-signed cert for "${commonName}" (${orgName}), valid 10 years. Set both values on the api and jobs services.\n`)
