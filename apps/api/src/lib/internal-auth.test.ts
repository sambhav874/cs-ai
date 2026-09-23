import { describe, expect, it } from 'vitest'
import { isInternalSecret } from './internal-auth.js'

describe('isInternalSecret', () => {
  it('accepts only the exact secret', () => {
    expect(isInternalSecret('s3cret', 's3cret')).toBe(true)
    expect(isInternalSecret('s3cre', 's3cret')).toBe(false)
    expect(isInternalSecret('s3cretX', 's3cret')).toBe(false)
  })

  it('fails closed when the secret is unset — never "undefined === undefined"', () => {
    expect(isInternalSecret(undefined, undefined)).toBe(false)
    expect(isInternalSecret('', '')).toBe(false)
    expect(isInternalSecret('anything', '')).toBe(false)
  })

  it('rejects non-string headers', () => {
    expect(isInternalSecret(['s3cret'], 's3cret')).toBe(false)
  })
})
