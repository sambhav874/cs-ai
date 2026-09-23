/**
 * Links a browser can open to a stored file: a contract's original, an
 * attachment, an obligation's evidence.
 *
 * The routes used to hand out S3 presigned URLs. With MinIO — every self-host,
 * and the dev VM — the presigned host is the storage service's name on the
 * container network (http://minio:9000/...), which no browser can reach: the
 * Original view, Download and "Open page N" all failed. So by default the API
 * serves the file itself, from a short-lived link:
 *
 *   /api/v1/files/<token>    token = one file, one disposition, 10 minutes
 *
 * The token is the authorisation — it is what lets the link open in a new tab
 * or a PDF viewer, which cannot send the Authorization header — and it is
 * signed with a key derived from JWT_SECRET, so it can never pass for a login
 * token or the other way round. FILE_LINKS=presigned restores direct S3 links
 * for a deployment whose storage is reachable from browsers (AWS S3).
 */
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { resolveSecret } from './secrets.js'
import { s3, S3_BUCKET } from './storage.js'

export type Disposition = 'inline' | 'attachment'

export interface FileLinkInput {
  key:          string
  filename?:    string | null
  contentType?: string | null
  disposition?: Disposition
  /** Seconds. Default 600. */
  expiresIn?:   number
}

export interface FileClaims {
  typ: 'file'
  key: string
  fn:  string
  ct:  string | null
  d:   Disposition
}

let derivedKey: Buffer | null = null
function linkKey(): Buffer {
  derivedKey ??= crypto.createHmac('sha256', resolveSecret('JWT_SECRET')).update('file-links:v1').digest()
  return derivedKey
}

/** A filename safe for a Content-Disposition header, with the RFC 5987 form for non-ASCII. */
export function contentDisposition(disposition: Disposition, filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '').slice(0, 180) || 'file'
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 180))}`
}

export function fileLinkMode(): 'proxy' | 'presigned' {
  return (process.env.FILE_LINKS ?? '').trim().toLowerCase() === 'presigned' ? 'presigned' : 'proxy'
}

export async function fileLink(input: FileLinkInput): Promise<string> {
  const filename = (input.filename ?? input.key.split('/').pop() ?? 'file').replace(/^\d+-/, '')
  const disposition = input.disposition ?? 'attachment'
  const expiresIn = input.expiresIn ?? 600

  if (fileLinkMode() === 'presigned') {
    return getSignedUrl(s3, new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.key,
      ResponseContentDisposition: contentDisposition(disposition, filename),
      ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
    }), { expiresIn })
  }

  const claims: FileClaims = { typ: 'file', key: input.key, fn: filename, ct: input.contentType ?? null, d: disposition }
  const token = jwt.sign(claims, linkKey(), { algorithm: 'HS256', expiresIn })
  return `/api/v1/files/${token}`
}

/** The claims of a valid, unexpired file link, or null. */
export function readFileLink(token: string): FileClaims | null {
  try {
    const claims = jwt.verify(token, linkKey(), { algorithms: ['HS256'] }) as FileClaims & { typ?: string }
    return claims.typ === 'file' && typeof claims.key === 'string' ? claims : null
  } catch {
    return null
  }
}
