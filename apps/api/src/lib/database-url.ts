/**
 * One MongoDB setting for the whole platform.
 *
 * MONGODB_URI names the cluster — local, or an Atlas `mongodb+srv://` string —
 * and each service opens its databases on it: ContractSense its several by
 * name, the lifecycle API the `csai` database. Prisma only takes a database in
 * the connection string, which is why the API used to need a second setting,
 * DATABASE_URL, pointing at the same cluster. It is now derived. An explicit
 * DATABASE_URL still wins (tests, local development).
 *
 * Run directly, it prints the resolved URL, so a shell step like
 * `prisma db push` can use it: DATABASE_URL="$(node --import tsx src/lib/database-url.ts)".
 */

export const PLATFORM_DB = 'csai'

/** The cluster string with its database path set to `db`, query kept. */
export function withDatabase(uri: string, db: string): string {
  const q = uri.indexOf('?')
  const head = q < 0 ? uri : uri.slice(0, q)
  const query = q < 0 ? '' : uri.slice(q)
  const hostsStart = head.indexOf('://') + 3
  const slash = head.indexOf('/', hostsStart)
  const hosts = slash < 0 ? head : head.slice(0, slash)
  return `${hosts}/${db}${query}`
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DATABASE_URL?.trim()
  if (explicit) return explicit
  const cluster = env.MONGODB_URI?.trim()
  return cluster ? withDatabase(cluster, PLATFORM_DB) : undefined
}

if (process.argv[1] && /database-url\.[tj]s$/.test(process.argv[1])) {
  const url = resolveDatabaseUrl()
  if (!url) {
    console.error('Set MONGODB_URI (or DATABASE_URL).')
    process.exit(1)
  }
  process.stdout.write(url)
}
