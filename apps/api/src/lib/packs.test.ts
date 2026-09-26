import { describe, expect, it } from 'vitest'
import { clauseHash, installablePacks, loadCategories, loadPack, positionHash, templateHash } from './packs.js'
import { packCatalog } from './org-seed.js'

describe('packs/ (merge step 8)', () => {
  it('loads the universal library and every installable pack from data', () => {
    const u = loadPack('universal')
    expect(loadCategories().length).toBe(18)
    expect(u.clauses.length).toBeGreaterThan(100)
    expect(u.templates.length).toBeGreaterThan(10)
    expect(installablePacks().map(p => p.manifest.id)).toEqual(['biotech', 'healthcare', 'logistics', 'manufacturing', 'saas'])
  })

  it('merges both halves of logistics in one pack', () => {
    const logistics = packCatalog().find(p => p.id === 'logistics')!
    expect(logistics).toMatchObject({ version: '1.0.0', extraction: true })
    expect(logistics.counts.clauses).toBeGreaterThan(0)
    const linked = loadPack('logistics').playbook.filter(p => p.obligation_class)
    expect(linked.map(p => p.obligation_class)).toContain('insurance_floor')
  })

  it('ships no clause as approved without a named reviewer', () => {
    for (const p of [loadPack('universal'), ...installablePacks()]) {
      for (const c of p.clauses) {
        if (c.review.status !== 'sample') expect(c.review.reviewer, `${p.manifest.id}/${c.key}`).toBeTruthy()
      }
    }
  })

  it('hashes the same content the same way, and any edit differently', () => {
    const c = loadPack('logistics').clauses[0]
    expect(clauseHash(c)).toBe(clauseHash({ ...c, tags: [...(c.tags ?? [])].reverse() }))
    expect(clauseHash({ ...c, text: c.text + ' ' })).not.toBe(clauseHash(c))
    const t = loadPack('logistics').templates[0]
    expect(templateHash({ ...t, sections: [...t.sections].reverse() })).toBe(templateHash(t))
    const p = loadPack('logistics').playbook[0]
    expect(positionHash({ ...p, risk_threshold: 0.1 })).not.toBe(positionHash(p))
  })
})
