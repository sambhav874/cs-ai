import { describe, it, expect } from 'vitest'
import { resolveApiScopePermissions, evaluatePermission } from './permissions.js'

// Wave 1.2 — the security-critical invariant: an empty scope list grants
// NOTHING (it used to silently become org ADMIN), and scope strings map to
// concrete permissions rather than being (mis)treated as role names.
describe('API-key scope resolution (Wave 1.2)', () => {
  const can = (scopes: string[], action: string, resource: string) =>
    evaluatePermission(resolveApiScopePermissions(scopes), action, resource).granted

  it('empty scopes grant NO permissions (not admin)', () => {
    expect(resolveApiScopePermissions([])).toHaveLength(0)
    expect(can([], 'view', 'contract')).toBe(false)
    expect(can([], 'delete', 'contract')).toBe(false)
    expect(can([], 'configure', 'organization')).toBe(false)
  })

  it('contracts:read grants read but not write/delete', () => {
    expect(can(['contracts:read'], 'view', 'contract')).toBe(true)
    expect(can(['contracts:read'], 'create', 'contract')).toBe(false)
    expect(can(['contracts:read'], 'delete', 'contract')).toBe(false)
  })

  it('contracts:write grants create + edit', () => {
    expect(can(['contracts:write'], 'create', 'contract')).toBe(true)
    expect(can(['contracts:write'], 'edit', 'contract')).toBe(true)
    expect(can(['contracts:write'], 'delete', 'contract')).toBe(false)
  })

  it('admin scope grants everything, but only when explicitly requested', () => {
    expect(can(['admin'], 'delete', 'contract')).toBe(true)
    expect(can(['admin'], 'configure', 'organization')).toBe(true)
  })

  it('unknown scopes contribute nothing', () => {
    expect(resolveApiScopePermissions(['bogus:scope'])).toHaveLength(0)
    expect(can(['bogus:scope'], 'view', 'contract')).toBe(false)
  })
})
