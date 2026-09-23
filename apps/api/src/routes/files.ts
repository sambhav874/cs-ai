/**
 * GET /api/v1/files/:token — serve one stored file from a link made by
 * lib/file-links.ts. The token is the credential (a new tab or a PDF viewer
 * cannot send the Authorization header); it names one object, one
 * disposition, and expires in minutes.
 */
import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import { GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3'
import { contentDisposition, readFileLink } from '../lib/file-links.js'
import { s3, S3_BUCKET } from '../lib/storage.js'

export async function fileRoutes(app: FastifyInstance) {
  app.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const claims = readFileLink(token)
    if (!claims) return reply.status(404).send({ detail: 'This link has expired or is not valid. Open the file again from the app.' })

    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: claims.key }))
      reply
        .header('content-type', claims.ct ?? obj.ContentType ?? 'application/octet-stream')
        .header('content-disposition', contentDisposition(claims.d, claims.fn))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
      if (obj.ContentLength != null) reply.header('content-length', String(obj.ContentLength))
      // An uploaded HTML or SVG must never run as this origin's page. PDFs are
      // exempt: browsers refuse to render a PDF under a sandbox policy, and
      // their viewer does not run the document's scripts as this origin.
      const type = claims.ct ?? obj.ContentType ?? ''
      if (claims.d === 'inline' && type !== 'application/pdf') {
        reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      }
      return reply.send(obj.Body as Readable)
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') {
        return reply.status(404).send({ detail: 'File not found' })
      }
      req.log.error({ err }, '[files] storage read failed')
      return reply.status(502).send({ detail: 'Storage is unavailable' })
    }
  })
}
