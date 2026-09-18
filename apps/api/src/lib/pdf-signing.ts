/**
 * pdf-signing.ts (Phase 07 Step 6) — pdf-lib signature certificate stamping.
 *
 * When a SignatureRequest reaches COMPLETED, we take the canonical PDF
 * for the contract version (renderedPdfKey ?? s3Key) and append a
 * signature certificate page with:
 *   • Document title + contract metadata
 *   • Each signer's: name, role, email, signed-name (typed), timestamp, IP
 *   • Org-level audit (signature_request id, completedAt, total signers)
 *
 * Returns the new PDF as a Buffer. Caller:
 *   1. Uploads to S3 under signed/<contractId>/<srId>.pdf
 *   2. Creates a new ContractVersion (versionNumber++) pointing at it
 *   3. Updates Contract.currentVersionId → that new version
 *
 * Wave 2.7 (2026-07): the final PDF is now sealed with a real PAdES/X.509
 * cryptographic signature (see lib/pades-signing.ts) and its SHA-256 hash is
 * recorded in audit_events, so the executed document is tamper-evident — any
 * later byte change invalidates the signature. The per-signer legal record
 * (typed name + IP + UA + timestamp) remains, both in audit_events and visible
 * on the certificate page.
 */
import { PDFDocument, StandardFonts, rgb, PageSizes } from 'pdf-lib'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from './storage.js'
import { signPdfWithPades } from './pades-signing.js'

interface SignerForCertificate {
  name: string
  role: string | null
  email: string
  signedName: string | null
  signedAt: Date | null
  signedIp: string | null
  signOrder: number
}

interface AppendCertificateArgs {
  /** PDF bytes for the signed document — usually fetched from S3. */
  sourcePdfBytes: Uint8Array | ArrayBuffer | Buffer
  /** Contract metadata for the certificate header. */
  contractTitle: string
  contractType: string
  /** Org / sender info. */
  orgName: string
  signatureRequestId: string
  /** Sorted by signOrder ASC then signedAt ASC for stable certificate output. */
  signers: SignerForCertificate[]
  /** When the request flipped to COMPLETED. */
  completedAt: Date
}

/**
 * Append a signature certificate page (or pages) to the source PDF and
 * return the merged Bytes. Caller is responsible for uploading the result.
 */
export async function appendSignatureCertificate(args: AppendCertificateArgs): Promise<Uint8Array> {
  // Load source — may be Buffer/Uint8Array. PDFDocument.load accepts both.
  const source = args.sourcePdfBytes instanceof Buffer
    ? args.sourcePdfBytes
    : Buffer.from(args.sourcePdfBytes as Uint8Array)
  const pdf = await PDFDocument.load(source)

  // Embed fonts ONCE, share across pages
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Add new page(s) — A4 portrait. ~841 height × 595 width pts.
  const page = pdf.addPage(PageSizes.A4)
  const { width, height } = page.getSize()
  const margin = 50

  // Header strip
  page.drawRectangle({
    x: 0, y: height - 70, width, height: 70,
    color: rgb(0.06, 0.46, 0.31),   // emerald-700
  })
  page.drawText('Signature Certificate', {
    x: margin, y: height - 40,
    font: helvB, size: 20, color: rgb(1, 1, 1),
  })
  page.drawText(`${args.orgName} · ${new Date(args.completedAt).toISOString().slice(0, 10)}`, {
    x: margin, y: height - 60,
    font: helv, size: 10, color: rgb(0.85, 0.95, 0.9),
  })

  // Document metadata block
  let cursor = height - 100
  page.drawText('Document', { x: margin, y: cursor, font: helvB, size: 9, color: rgb(0.5, 0.5, 0.5) })
  cursor -= 14
  page.drawText(args.contractTitle.slice(0, 110), {
    x: margin, y: cursor, font: helvB, size: 13, color: rgb(0.1, 0.1, 0.1),
  })
  cursor -= 14
  page.drawText(`${args.contractType.replace(/_/g, ' ')} · Signature request id: ${args.signatureRequestId}`, {
    x: margin, y: cursor, font: helv, size: 9, color: rgb(0.5, 0.5, 0.5),
  })
  cursor -= 30

  // Divider
  page.drawLine({
    start: { x: margin, y: cursor }, end: { x: width - margin, y: cursor },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
  })
  cursor -= 22
  page.drawText(`Signers (${args.signers.length})`, {
    x: margin, y: cursor, font: helvB, size: 10, color: rgb(0.2, 0.2, 0.2),
  })
  cursor -= 20

  // Per-signer block
  for (const s of args.signers) {
    if (cursor < 100) {
      // Add another page if running short — rare with up to 20 signers
      const extra = pdf.addPage(PageSizes.A4)
      const sz = extra.getSize()
      cursor = sz.height - margin
    }
    // Card-like background
    page.drawRectangle({
      x: margin, y: cursor - 70, width: width - margin * 2, height: 70,
      color: rgb(0.97, 0.97, 0.97),
      borderColor: rgb(0.9, 0.9, 0.9), borderWidth: 0.5,
    })
    // Signer name + role
    page.drawText(s.name + (s.role ? ` · ${s.role}` : ''), {
      x: margin + 12, y: cursor - 16, font: helvB, size: 11, color: rgb(0.06, 0.46, 0.31),
    })
    // Email
    page.drawText(s.email, {
      x: margin + 12, y: cursor - 30, font: helv, size: 9, color: rgb(0.4, 0.4, 0.4),
    })
    // Signed-name (the typed signature)
    if (s.signedName) {
      page.drawText('Signed as:', {
        x: margin + 12, y: cursor - 46, font: helv, size: 8, color: rgb(0.5, 0.5, 0.5),
      })
      // Italic-ish "signature" — use bold font as a stand-in until we add a script font.
      page.drawText(s.signedName, {
        x: margin + 75, y: cursor - 46, font: helvB, size: 11, color: rgb(0.1, 0.1, 0.1),
      })
    }
    // Timestamp + IP — right column
    if (s.signedAt) {
      page.drawText(`Signed: ${new Date(s.signedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`, {
        x: margin + 12, y: cursor - 60, font: helv, size: 8, color: rgb(0.5, 0.5, 0.5),
      })
    }
    if (s.signedIp) {
      page.drawText(`IP: ${s.signedIp}`, {
        x: width - margin - 110, y: cursor - 60, font: helv, size: 8, color: rgb(0.5, 0.5, 0.5),
      })
    }
    if (s.signOrder > 1 || args.signers.some(o => o.signOrder !== s.signOrder)) {
      page.drawText(`Order #${s.signOrder}`, {
        x: width - margin - 60, y: cursor - 16, font: helv, size: 9, color: rgb(0.5, 0.5, 0.5),
      })
    }
    cursor -= 80
  }

  // Footer
  page.drawText(
    'This certificate is generated automatically when all required signatures are collected. ' +
    'Each signer\'s typed name, IP address, and timestamp constitute the legal record of consent. ' +
    'The completed document is sealed with a PAdES/X.509 digital signature (SHA-256); any ' +
    'modification after signing invalidates it.',
    {
      x: margin, y: 40, font: helv, size: 7,
      color: rgb(0.55, 0.55, 0.55),
      maxWidth: width - margin * 2,
      lineHeight: 10,
    },
  )
  page.drawText(`Generated ${new Date().toISOString()} · sealed with PAdES/X.509 (SHA-256)`, {
    x: margin, y: 22, font: helv, size: 7, color: rgb(0.7, 0.7, 0.7),
  })

  return await pdf.save()
}

/** Convenience: fetch source PDF from S3, append cert, upload signed PDF, return the new key. */
export async function generateAndStoreSignedPdf({
  sourceKey,
  signedKeyPrefix,
  contractTitle,
  contractType,
  orgName,
  signatureRequestId,
  signers,
  completedAt,
}: {
  sourceKey: string
  /** e.g. `signed/<contractId>` — `<srId>.pdf` will be appended. */
  signedKeyPrefix: string
  contractTitle: string
  contractType: string
  orgName: string
  signatureRequestId: string
  signers: SignerForCertificate[]
  completedAt: Date
}): Promise<{ signedKey: string; sizeBytes: number; documentHash: string }> {
  // 1. Pull the source bytes from S3
  const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: sourceKey }))
  if (!obj.Body) throw new Error(`pdf-signing: source ${sourceKey} not found`)
  // @aws-sdk Body is a Readable stream in Node — collect to buffer
  const chunks: Buffer[] = []
  for await (const chunk of obj.Body as AsyncIterable<Buffer>) chunks.push(chunk)
  const sourceBytes = Buffer.concat(chunks)

  // 2. Append the human-readable certificate page
  const certBytes = await appendSignatureCertificate({
    sourcePdfBytes: sourceBytes,
    contractTitle, contractType, orgName,
    signatureRequestId, signers, completedAt,
  })

  // 3. Wave 2.7 — apply a real PAdES/X.509 cryptographic signature over the
  //    whole document. Any later byte change invalidates it, so the signed PDF
  //    is tamper-evident (not just a cosmetic cert page). The returned hash is
  //    stored in audit_events so the record is independently verifiable.
  const { signedPdf, sha256 } = await signPdfWithPades(certBytes, {
    reason: `Executed via draftLegal — signature request ${signatureRequestId}`,
    name: `${orgName} (via draftLegal Signing Authority)`,
  })

  // 4. Upload the signed PDF
  const signedKey = `${signedKeyPrefix.replace(/\/$/, '')}/${signatureRequestId}.pdf`
  // S3 user-defined metadata only allows ASCII — strip non-ASCII chars
  // (em-dashes, smart quotes, etc.) so unicode contract titles don't
  // fail the upload with "Invalid character in header content".
  const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').slice(0, 200)
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET, Key: signedKey, Body: signedPdf,
    ContentType: 'application/pdf',
    Metadata: {
      contractTitle: ascii(contractTitle),
      signatureRequestId,
      signedAt: completedAt.toISOString(),
      sha256,
    },
  }))
  return { signedKey, sizeBytes: signedPdf.length, documentHash: sha256 }
}
