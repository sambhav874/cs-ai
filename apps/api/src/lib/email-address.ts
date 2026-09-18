/**
 * Address parsing for the inbound-email webhook.
 *
 * These two functions are the ONLY things standing between an arbitrary email
 * and a write into a contract: one decides who the sender is (and therefore
 * whether they pass the allow-list), the other decides which contract the mail
 * is filed against. Both are pure, and both have a plausible-looking wrong
 * implementation, so they live here with tests rather than inline in the route.
 */

/**
 * Reduce an RFC 5322 address to the bare mailbox.
 *   `Jane Doe <jane@x.com>` → `jane@x.com`
 *
 * SECURITY: a display name may legally contain a full address, so matching the
 * FIRST `<...>` lets a sender forge their identity:
 *   `"Trusted <counterparty@victim.com>" <attacker@evil.com>`
 * resolves to the victim's address and passes the sender allow-list, while the
 * message genuinely originates from — and passes SPF/DKIM for — evil.com. The
 * same trick on To: reroutes the mail to an arbitrary contract id.
 *
 * So: drop quoted display-names first, then take the LAST angle-bracket pair,
 * which is where RFC 5322 name-addr puts the real mailbox.
 */
export function bareAddress(v: string): string {
  const withoutQuoted = (v ?? '').replace(/"(?:[^"\\]|\\.)*"/g, ' ')
  const brackets = withoutQuoted.match(/<[^<>]*>/g)
  const picked = brackets?.length
    ? brackets[brackets.length - 1].slice(1, -1)
    : withoutQuoted
  return picked.trim().toLowerCase()
}

/**
 * Extract the `+tag` from the local part of an address.
 *   contracts+abc123@inbound.foo.com  →  "abc123"
 * Expects an address already reduced by bareAddress().
 */
export function extractContractTag(toAddress: string): string | null {
  const match = (toAddress ?? '').toLowerCase().match(/^[^@]*\+([^@]+)@/)
  return match ? match[1] : null
}
