import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'

export const S3_BUCKET = process.env.S3_BUCKET ?? 'clm-documents'

// Prefer S3_* env vars (used by the production Cloud Run deploy + docker-compose)
// and fall back to AWS_* so this still works against real AWS S3 if anyone wires
// it up that way.
const accessKeyId = process.env.S3_ACCESS_KEY     ?? process.env.AWS_ACCESS_KEY_ID     ?? 'minioadmin'
const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? 'minioadmin'
const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1'

export const s3 = new S3Client({
  region,
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
  // GCS via the S3-compat XML API rejects the AWS-specific
  // `x-amz-checksum-crc32` / `x-amz-sdk-checksum-algorithm` headers the
  // v3 SDK adds by default — the headers end up in the signed-headers
  // list but GCS strips them, producing SignatureDoesNotMatch. Force the
  // SDK to only compute checksums when an operation strictly requires it.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch {
    // Bucket doesn't exist — create it
    await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
  }
}
