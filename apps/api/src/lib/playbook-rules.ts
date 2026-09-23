/**
 * Playbook rules: the deterministic half of a playbook check.
 *
 * A position's `rules` JSON lists phrases a clause must contain (must_have)
 * or must not (must_not). The playbook page edits them as two plain lists,
 * "Must include" and "Must not include" (see rulesFromPhrases); the checker,
 * the review and the playbook's test box all evaluate them here, so the three
 * cannot disagree about what a rule means.
 */
// ── P1.2 — Structured playbook rules (docs/28 C.2.1) ────────────────────
// `PlaybookPosition.rules` is free-form JSON; we runtime-type it via
// the shape below. Everything optional — orgs can ship must_have without
// must_not, bounds-only configs, etc.
/**
 * One severity vocabulary for the whole playbook surface.
 *
 * The structured-rules path used `low|medium|high|walkaway`; the LLM review
 * path (playbook_review_agent.py) emits `low|medium|high|critical`. Both write
 * into the same field, so an org whose rules say `critical` was silently
 * mis-ranked. `critical` is accepted here and treated as equivalent to
 * `walkaway` — both mean "a human must look at this before it goes anywhere".
 */
export type PlaybookSeverity = 'low' | 'medium' | 'high' | 'critical' | 'walkaway'
export type PlaybookRuleCheck = 'contains' | 'regex' | 'present' | 'absent'

export interface PlaybookRule {
  id?:          string
  description:  string
  check:        PlaybookRuleCheck
  value:        string     // substring / regex source / marker token
  severity:     PlaybookSeverity
}

export interface PlaybookBound {
  min?:         number
  max?:         number
  units?:       string
  severity:     PlaybookSeverity
  description?: string
}

export interface PlaybookRules {
  must_have?:   PlaybookRule[]
  must_not?:    PlaybookRule[]
  bounds?:      Record<string, PlaybookBound>
  variables?:   Array<{ key: string; type: string; required?: boolean; default?: unknown }>
}

// Ascending. `critical` and `walkaway` are peers — different words for the same
// stop condition, arriving from the LLM path and the rules path respectively.
export const SEVERITY_ORDER: PlaybookSeverity[] = ['low', 'medium', 'high', 'critical', 'walkaway']

/**
 * Rank a severity, tolerating values written by hand into a rules JSON.
 *
 * `SEVERITY_ORDER.indexOf(x)` returns -1 for anything unrecognised, and -1 is
 * LOWER than every real rank — so an unknown severity lost to the next `low`
 * that came along. That is how a `critical` violation ended up reported as
 * `low`. Unknown values now rank at the TOP: if we cannot interpret how
 * serious something is, the safe reading is "serious".
 */
export function severityRank(sev: string | undefined | null): number {
  if (!sev) return -1
  const i = SEVERITY_ORDER.indexOf(sev as PlaybookSeverity)
  return i === -1 ? SEVERITY_ORDER.length : i
}

/**
 * Walk a rules object against a clause's text. Returns one entry per
 * evaluated rule with `{passed, ...}`. "Bounds" checks compile to
 * "no strong assertion" today (P1.3 will pair them with an LLM judge);
 * they appear in the output so the agent LLM can reason over them.
 */
export function evaluatePlaybookRules(
  rules:        PlaybookRules,
  clauseText:   string,
  positionType: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const text = clauseText.toLowerCase()

  for (const r of rules.must_have ?? []) {
    const passed = ruleMatches(r, text)
    out.push({
      kind: 'must_have', position: positionType,
      ruleId: r.id, description: r.description, severity: r.severity,
      check: r.check, value: r.value,
      // "passed" for a must_have rule means the match hit.
      passed,
    })
  }
  for (const r of rules.must_not ?? []) {
    const hit = ruleMatches(r, text)
    out.push({
      kind: 'must_not', position: positionType,
      ruleId: r.id, description: r.description, severity: r.severity,
      check: r.check, value: r.value,
      // For must_not we flip: "passed" means the text does NOT contain it.
      passed: !hit,
    })
  }
  for (const [key, b] of Object.entries(rules.bounds ?? {})) {
    out.push({
      kind: 'bound', position: positionType,
      boundKey: key, description: b.description, severity: b.severity,
      min: b.min, max: b.max, units: b.units,
      // Leave `passed` null — bounds need numeric extraction which we
      // defer to P1.3 (two-stage compare). The agent LLM can still see
      // the bound and reason over the clause text.
      passed: null,
    })
  }
  return out
}

export function ruleMatches(rule: PlaybookRule, lowerText: string): boolean {
  switch (rule.check) {
    case 'contains': return lowerText.includes(rule.value.toLowerCase())
    case 'regex':
      try { return new RegExp(rule.value, 'i').test(lowerText) }
      catch { return false }
    case 'present':  return lowerText.includes(rule.value.toLowerCase())
    case 'absent':   return !lowerText.includes(rule.value.toLowerCase())
    default:         return false
  }
}

export function pickWorstSeverity(
  violations: Array<Record<string, unknown>>,
): PlaybookSeverity | null {
  let worst: PlaybookSeverity | null = null
  for (const v of violations) {
    if (v.passed === true || v.passed === null) continue // no violation
    const sev = v.severity as PlaybookSeverity | undefined
    if (!sev) continue
    if (!worst || severityRank(sev) > severityRank(worst)) {
      worst = sev
    }
  }
  return worst
}

export function ruleCountOf(rules: PlaybookRules | null): number {
  if (!rules) return 0
  return (rules.must_have?.length ?? 0)
       + (rules.must_not?.length  ?? 0)
       + Object.keys(rules.bounds ?? {}).length
}


// ── Phrases: the playbook page's view of rules ──────────────────────────────

/**
 * How serious a broken phrase rule is follows from the rung it sits on. A
 * preferred clause missing a phrase has slipped to acceptable at worst; a
 * walkaway phrase appearing is a stop. Nobody has to pick a severity per
 * phrase, which is what keeps the editor to two plain lists.
 */
const MUST_INCLUDE_SEVERITY: Record<string, PlaybookSeverity> = {
  preferred: 'low', acceptable: 'medium', fallback: 'high', walkaway: 'high',
}
const MUST_NOT_SEVERITY: Record<string, PlaybookSeverity> = {
  preferred: 'medium', acceptable: 'medium', fallback: 'high', walkaway: 'walkaway',
}

export interface PlaybookPhrases {
  mustInclude:    string[]
  mustNotInclude: string[]
}

const isPhraseRule = (r: PlaybookRule) => r.check === 'contains' || r.check === 'present'

export function cleanPhrases(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const p = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!p || seen.has(p.toLowerCase())) continue
    seen.add(p.toLowerCase())
    out.push(p)
  }
  return out.slice(0, 25)
}

/** The plain phrase lists a position's rules hold. Regex and bound rules are not phrases. */
export function phrasesFromRules(rules: PlaybookRules | null | undefined): PlaybookPhrases {
  return {
    mustInclude:    (rules?.must_have ?? []).filter(isPhraseRule).map(r => r.value),
    mustNotInclude: (rules?.must_not ?? []).filter(isPhraseRule).map(r => r.value),
  }
}

/**
 * Write phrase lists into a rules object. Only phrase rules are replaced:
 * regex rules, bounds and variables someone wrote by hand survive an edit
 * made on the page, which cannot show them.
 */
export function rulesWithPhrases(
  existing: PlaybookRules | null | undefined,
  phrases: Partial<PlaybookPhrases>,
  positionType: string,
): PlaybookRules {
  const base: PlaybookRules = { ...(existing ?? {}) }
  if (phrases.mustInclude) {
    base.must_have = [
      ...(existing?.must_have ?? []).filter(r => !isPhraseRule(r)),
      ...cleanPhrases(phrases.mustInclude).map(value => ({
        description: `Should include "${value}"`,
        check: 'contains' as const, value,
        severity: MUST_INCLUDE_SEVERITY[positionType] ?? 'medium',
      })),
    ]
  }
  if (phrases.mustNotInclude) {
    base.must_not = [
      ...(existing?.must_not ?? []).filter(r => !isPhraseRule(r)),
      ...cleanPhrases(phrases.mustNotInclude).map(value => ({
        description: positionType === 'walkaway' ? `Red flag: says "${value}"` : `Should not include "${value}"`,
        check: 'contains' as const, value,
        severity: MUST_NOT_SEVERITY[positionType] ?? 'medium',
      })),
    ]
  }
  return base
}

function phraseLine(kind: string, value: string, positionType: string): string {
  if (kind === 'must_have') return `Should include "${value}"`
  return positionType === 'walkaway' ? `Red flag: says "${value}"` : `Should not include "${value}"`
}

/** Only the rules that failed, as short lines a reviewer can read. */
export function failedRules(
  rules: PlaybookRules | null | undefined,
  clauseText: string,
  positionType: string,
): Array<{ description: string; severity: PlaybookSeverity; kind: 'must_have' | 'must_not'; position: string }> {
  if (!rules) return []
  return evaluatePlaybookRules(rules, clauseText, positionType)
    .filter(v => v.passed === false)
    .map(v => ({
      // Phrase rules are worded here rather than trusted from storage, so a
      // rule saved before the wording changed reads the same as a new one.
      description: (v.check === 'contains' || v.check === 'present') && typeof v.value === 'string'
        ? phraseLine(v.kind as string, v.value, positionType)
        : String(v.description ?? v.value ?? ''),
      severity:    (v.severity as PlaybookSeverity) ?? 'medium',
      kind:        v.kind as 'must_have' | 'must_not',
      position:    positionType,
    }))
}
