import { Redis } from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
})

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message)
})
