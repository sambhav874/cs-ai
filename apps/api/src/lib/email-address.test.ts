import { describe, it, expect } from 'vitest'
import { bareAddress, extractContractTag } from './email-address.js'

describe('bareAddress', () => {
  it('returns a bare address unchanged (lowercased)', () => {
    expect(bareAddress('Jane@X.com')).toBe('jane@x.com')
  })

  it('extracts from the standard display-name form', () => {
    expect(bareAddress('Jane Doe <jane@x.com>')).toBe('jane@x.com')
  })

  it('trims surrounding whitespace', () => {
    expect(bareAddress('  <jane@x.com>  ')).toBe('jane@x.com')
  })

  // ── Spoofing regressions ────────────────────────────────────────────────
  // A display name may legally contain a full address. Taking the FIRST
  // <...> match would return the attacker-chosen decoy and pass the sender
  // allow-list, while the mail really comes from the attacker's domain.

  it('does NOT let a quoted display-name override the real mailbox', () => {
    expect(
      bareAddress('"Trusted <counterparty@victim.com>" <attacker@evil.com>'),
    ).toBe('attacker@evil.com')
  })

  it('does NOT let an unquoted decoy override the real mailbox', () => {
    expect(
      bareAddress('=?utf-8?q?x?= <counterparty@victim.com> <attacker@evil.com>'),
    ).toBe('attacker@evil.com')
  })

  it('does NOT let a quoted decoy reroute the To: address', () => {
    const to = bareAddress('"<contracts+VICTIM@x.com>" <contracts+mine@inbound.example.com>')
    expect(to).toBe('contracts+mine@inbound.example.com')
    expect(extractContractTag(to)).toBe('mine')
  })

  it('handles escaped quotes inside the display name', () => {
    expect(bareAddress('"a \\" <decoy@evil.com>" <real@x.com>')).toBe('real@x.com')
  })

  it('is not tripped by an empty string', () => {
    expect(bareAddress('')).toBe('')
  })
})

describe('extractContractTag', () => {
  it('pulls the +tag from the local part', () => {
    expect(extractContractTag('contracts+abc123@inbound.foo.com')).toBe('abc123')
  })

  it('lowercases the tag', () => {
    expect(extractContractTag('contracts+ABC123@inbound.foo.com')).toBe('abc123')
  })

  it('returns null with no +tag', () => {
    expect(extractContractTag('contracts@inbound.foo.com')).toBeNull()
  })

  it('returns null for a non-address', () => {
    expect(extractContractTag('not-an-address')).toBeNull()
  })

  it('does not read a +tag from the domain', () => {
    expect(extractContractTag('plain@host+notatag.com')).toBeNull()
  })
})
