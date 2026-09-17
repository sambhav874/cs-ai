import { describe, it, expect, afterEach } from 'vitest'
import { resolveSecret } from './secrets.js'

// Wave 1.1 — the security-critical behaviour is: production must NEVER fall
// back to a hardcoded/weak secret. These tests lock that in.
const SAVED = { ...process.env }
afterEach(() => {
  process.env = { ...SAVED }
})

describe('resolveSecret (Wave 1.1 fail-closed secrets)', () => {
  it('throws in production when the secret is unset', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.JWT_SECRET
    expect(() => resolveSecret('JWT_SECRET')).toThrow(/not set/i)
  })

  it('throws in production for a known-insecure placeholder (change-me…)', () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'change-me-please-min-32-characters-long!!'
    expect(() => resolveSecret('JWT_SECRET')).toThrow(/placeholder/i)
  })

  it('throws in production for a too-short secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'short'
    expect(() => resolveSecret('JWT_SECRET')).toThrow(/too short/i)
  })

  it('accepts a strong, non-placeholder secret in production', () => {
    process.env.NODE_ENV = 'production'
    const strong = 'Zk9' + 'x'.repeat(45)
    process.env.JWT_SECRET = strong
    expect(resolveSecret('JWT_SECRET')).toBe(strong)
  })

  it('generates a usable dev secret when unset outside production', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.PORTAL_JWT_SECRET
    const s = resolveSecret('PORTAL_JWT_SECRET')
    expect(s.length).toBeGreaterThanOrEqual(32)
  })
})
