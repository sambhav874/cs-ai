/**
 * docx-export.ts (Phase 4)
 *
 * Produces a Word document with native tracked changes between two contract
 * versions, so a lawyer can open it, use Word's own Accept/Reject controls, and
 * send it to the counterparty.
 *
 * Shaped like lib/compliance-export.ts: org-scoped reads, sentinel error
 * strings for the route to map onto status codes, returns bytes and does no
 * reply handling.
 *
 * The source of truth is a RE-DIFF of the two versions' HTML, not stored
 * metadata. `metadata.redline` exists only on versions created by
 * redline_apply — never for editor saves, uploads, or template output — so
 * building the markup from it would silently export nothing for most version
 * pairs.
 */
import {
  Document, Packer, Paragraph, Table, LevelFormat, AlignmentType,
} from 'docx'
import { prisma } from './prisma.js'
import { computeVersionDiff } from './diff.js'
import { DocxMapper, ORDERED_LIST_REF, type RevisionMeta } from './html-to-docx.js'
import { resolveRevisionAuthor, toRevisionDate } from './revision-author.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from './storage.js'
import { redlineOriginalDocx, type DocxRedlineStats } from './docx-redline.js'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function readObject(key: string): Promise<Buffer> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
  const chunks: Buffer[] = []
  for await (const chunk of obj.Body as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export interface RedlineDocxArgs {
  contractId: string
  orgId:      string
  v1Id:       string
  v2Id:       string
}

export interface RedlineDocxResult {
  bytes:      Uint8Array
  title:      string
  author:     string
  stats:      { insertions: number; deletions: number }
  /**
   * native: the tracked changes are written into the uploaded .docx itself,
   * so its numbering, styles, headers and page setup survive. rebuilt: the
   * document is regenerated from the app's HTML (no uploaded Word base).
   */
  mode:       'native' | 'rebuilt'
  native?:    DocxRedlineStats
}

export async function generateRedlineDocx(args: RedlineDocxArgs): Promise<RedlineDocxResult> {
  const { contractId, orgId, v1Id, v2Id } = args

  const contract = await prisma.contract.findFirst({
    where:  { id: contractId, orgId, deletedAt: null },
    select: { id: true, title: true, org: { select: { name: true } } },
  })
  if (!contract) throw new Error('contract_not_found')

  // Scope both versions to THIS contract before reading their content. The
  // diff route learned this the hard way: version ids alone are not an
  // authorisation boundary.
  const [v1, v2] = await Promise.all([
    prisma.contractVersion.findFirst({
      where: { id: v1Id, contractId },
      select: { id: true, versionNumber: true, htmlContent: true, createdById: true, createdAt: true, s3Key: true, mimeType: true },
    }),
    prisma.contractVersion.findFirst({
      where: { id: v2Id, contractId },
      select: { id: true, versionNumber: true, htmlContent: true, createdById: true, createdAt: true },
    }),
  ])
  if (!v1 || !v2) throw new Error('version_not_found')

  // A version still moving through extraction has htmlContent ''. Diffing
  // against that renders the whole of the other version as one giant deletion,
  // which is worse than refusing — the reviewer would accept a document that
  // deletes their contract.
  if (!v1.htmlContent?.trim() || !v2.htmlContent?.trim()) throw new Error('version_pending')

  const { diffHtml, stats } = computeVersionDiff(v1.htmlContent, v2.htmlContent)

  // A two-version diff has exactly one author: whoever produced v2. Per-change
  // attribution would need metadata.redline, which is polymorphic and present
  // on only a minority of version-create paths — deliberately out of scope.
  const author = await resolveRevisionAuthor(v2.createdById, contract.org?.name ?? 'draftLegal')
  const meta: RevisionMeta = { author, date: toRevisionDate(v2.createdAt) }

  // The base is the counterparty's Word file: mark the changes up in it,
  // rather than send back a document we rebuilt.
  if (v1.s3Key && v1.mimeType === DOCX_MIME) {
    try {
      const original = await readObject(v1.s3Key)
      const native = await redlineOriginalDocx({
        docx: original, baseHtml: v1.htmlContent, nextHtml: v2.htmlContent,
        revision: { author, date: meta.date },
      })
      return { bytes: native.bytes, title: contract.title, author, stats, mode: 'native', native: native.stats }
    } catch (err) {
      // An unreadable or unusual file falls back to the rebuilt document,
      // which still carries every change; say so in the logs.
      console.warn('[redline-docx] native redline failed, rebuilding instead:', (err as Error).message)
    }
  }

  const body = new DocxMapper(meta).map(diffHtml) as (Paragraph | Table)[]

  const doc = new Document({
    title:          `Redline — ${contract.title}`,
    creator:        'draftLegal',
    description:    `Tracked changes from v${v1.versionNumber} to v${v2.versionNumber}`,
    // Without a numbering definition, any paragraph referencing it is dropped.
    numbering: {
      config: [{
        reference: ORDERED_LIST_REF,
        levels: Array.from({ length: 5 }, (_, i) => ({
          level: i,
          format: LevelFormat.DECIMAL,
          text: `%${i + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: {
      paragraphStyles: [{
        id: 'Monospace',
        name: 'Monospace',
        basedOn: 'Normal',
        quickFormat: false,
        run: { font: 'Courier New', size: 20 },
      }],
    },
    sections: [{ children: body }],
  })

  const bytes = await Packer.toBuffer(doc)
  return { bytes, title: contract.title, author, stats, mode: 'rebuilt' }
}

/**
 * A plain .docx of one version's HTML — no revisions, no diff.
 *
 * Exists because two endpoints were serving Gotenberg's
 * /forms/libreoffice/convert output — which is a PDF — under a .docx filename
 * and the wordprocessingml MIME type. Word refuses to open those, and one of
 * them is the counterparty-facing portal download whose whole purpose is
 * "download .docx -> redline locally -> upload back".
 *
 * Reuses the same mapper as the redline export; HTML with no <ins>/<del>
 * simply produces a document with no tracked changes.
 */
export async function generatePlainDocx(
  html: string,
  { title, author = 'draftLegal' }: { title: string; author?: string },
): Promise<Uint8Array> {
  const meta: RevisionMeta = { author, date: toRevisionDate(new Date()) }
  const body = new DocxMapper(meta).map(html) as (Paragraph | Table)[]

  const doc = new Document({
    title,
    creator: 'draftLegal',
    numbering: {
      config: [{
        reference: ORDERED_LIST_REF,
        levels: Array.from({ length: 5 }, (_, i) => ({
          level: i,
          format: LevelFormat.DECIMAL,
          text: `%${i + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: {
      paragraphStyles: [{
        id: 'Monospace', name: 'Monospace', basedOn: 'Normal',
        quickFormat: false, run: { font: 'Courier New', size: 20 },
      }],
    },
    sections: [{ children: body }],
  })
  return Packer.toBuffer(doc)
}
