/**
 * PAdES / X.509 PDF signing (Wave 2.7, 2026-07).
 *
 * Applies a real, tamper-evident cryptographic signature to an executed
 * contract PDF: adds a signature placeholder (pdf-lib), then embeds a PKCS#7
 * (adbe.pkcs7.detached) SignedData over the document's ByteRange using the
 * org signing cert. Any later byte change invalidates the signature — unlike
 * the previous cosmetic certificate page, which anyone with S3/DB write access
 * could swap the underlying document under.
 *
 * Verified with `pdfsig` (poppler): reports SHA-256 / adbe.pkcs7.detached /
 * "Total document signed" / "Signature is Valid".
 */
import { PDFDocument } from 'pdf-lib'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { P12Signer } from '@signpdf/signer-p12'
import { SignPdf } from '@signpdf/signpdf'
import crypto from 'node:crypto'
import { getSigningP12 } from './signing-cert.js'

export interface PadesSignResult {
  /** The signed PDF bytes (with the embedded PKCS#7 signature). */
  signedPdf: Buffer
  /** SHA-256 of the signed bytes — store in the audit trail to detect tampering. */
  sha256: string
}

export interface PadesSignOptions {
  reason: string          // e.g. "Executed by all parties"
  name: string            // signing authority / org name
  contactInfo?: string
  location?: string
}

/**
 * Sign a PDF with a PAdES-B signature. `pdfBytes` should already contain the
 * final visual content (e.g. the appended certificate page) — we do not modify
 * it beyond adding the signature dictionary.
 */
export async function signPdfWithPades(
  pdfBytes: Uint8Array | Buffer,
  opts: PadesSignOptions,
): Promise<PadesSignResult> {
  const doc = await PDFDocument.load(pdfBytes instanceof Buffer ? pdfBytes : Buffer.from(pdfBytes))

  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: opts.reason,
    contactInfo: opts.contactInfo ?? '',
    name: opts.name,
    location: opts.location ?? '',
    signatureLength: 8192, // headroom for the PKCS#7 container
  })

  // useObjectStreams:false is REQUIRED — @signpdf locates the /ByteRange in the
  // raw PDF, which object streams would hide.
  const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }))

  const { p12, passphrase } = getSigningP12()
  const signer = new P12Signer(p12, { passphrase })
  const signedPdf = Buffer.from(await new SignPdf().sign(withPlaceholder, signer))

  const sha256 = crypto.createHash('sha256').update(signedPdf).digest('hex')
  return { signedPdf, sha256 }
}
