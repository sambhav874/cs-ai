#!/usr/bin/env node
/**
 * port-cs.mjs — bring ContractSense screens into the SPA (merge runbook step 5).
 *
 *   node scripts/port-cs.mjs app/dashboard/page.tsx components/projects/ProjectMemoryPanel.tsx
 *
 * Entries are paths inside vendor/contractsense/apps/frontend. The script
 * follows every `@/…` and relative import from them, copies the whole reachable
 * tree into src/features/intelligence (imported as `@cs/…`), and rewrites it on
 * the way in:
 *
 *   - "use client" directives are dropped (no server components here).
 *   - `@/x` imports become `@cs/x`. `next/link`, `next/navigation`,
 *     `next/dynamic` and `next/image` stay as written — vite.config.ts and
 *     tsconfig alias them to the shims in src/features/intelligence/shims.
 *   - Stock Tailwind hues, ContractSense's brand hexes and `cs-*` colours map
 *     onto the cs-ai tokens, by meaning (blue → primary, green → success, red →
 *     risk, amber → attention, violet → assist, grey → surface/fg). `dark:`
 *     overrides are dropped: the tokens already switch with the theme.
 *
 * Re-running is safe. src/features/intelligence/.ported.json records a hash of
 * what the script wrote; a file whose contents no longer match was edited by
 * hand after porting and is left alone (reported as "kept").
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CS = resolve(WEB, '../../vendor/contractsense/apps/frontend')
const DEST = join(WEB, 'src/features/intelligence')
const MANIFEST = join(DEST, '.ported.json')

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

// ── Colour mapping ────────────────────────────────────────────────────────────

const NEUTRAL = 'gray|slate|zinc|neutral|stone'
// Violet means "a model wrote this" in the cs-ai system. ContractSense also
// used purple as a plain category/chart hue; outside its agent surfaces that
// becomes info.
const MACHINE_SURFACE = /^(components\/agent\/|components\/ContractAgentPanel|components\/ThinkingDisplay|hooks\/useAgent|lib\/agent)/
let currentFile = ''
const FAMILY = [
  [/^(blue|sky|cs-primary)$/, 'primary'],
  [/^(green|emerald|teal|lime)$/, 'success'],
  [/^(red|rose|cs-secondary)$/, 'risk'],
  [/^(amber|yellow|orange)$/, 'attention'],
  [/^(indigo|violet|purple|fuchsia)$/, 'assist'],
  [/^(cyan)$/, 'info'],
  [/^(pink)$/, 'risk'],
]
const STEPS = {
  primary: { 50: 50, 100: 100, 200: 200, 300: 200, 400: 500, 500: 500, 600: 700, 700: 700, 800: 800, 900: 800, 950: 800 },
  success: { 50: 50, 100: 100, 200: 200, 300: 200, 400: 500, 500: 500, 600: 700, 700: 700, 800: 800, 900: 800, 950: 800 },
  risk: { 50: 50, 100: 100, 200: 200, 300: 200, 400: 600, 500: 600, 600: 600, 700: 700, 800: 900, 900: 900, 950: 900 },
  attention: { 50: 50, 100: 100, 200: 200, 300: 200, 400: 600, 500: 600, 600: 600, 700: 700, 800: 700, 900: 700, 950: 700 },
  assist: { 50: 50, 100: 50, 200: 200, 300: 200, 400: 600, 500: 600, 600: 600, 700: 700, 800: 900, 900: 900, 950: 900 },
  info: { 50: 50, 100: 100, 200: 200, 300: 200, 400: 600, 500: 600, 600: 600, 700: 700, 800: 700, 900: 700, 950: 700 },
}
// Neutrals: grounds and borders read from the surface ramp, text from fg.
function neutral(util, step) {
  const n = Number(step)
  const isText = util === 'text' || util === 'placeholder' || util === 'fill' || util === 'stroke'
  if (isText) {
    if (n <= 400) return 'fg-400'
    if (n === 500) return 'fg-500'
    if (n <= 700) return 'fg-700'
    return 'fg-950'
  }
  if (n <= 50) return 'surface-50'
  if (n <= 100) return 'surface-100'
  if (n <= 200) return 'surface-200'
  if (n <= 300) return 'surface-300'
  if (n <= 500) return 'fg-400'
  if (n <= 700) return 'fg-700'
  return 'fg-950'
}
const HEX = {
  '015ca9': 'primary-700', '0084c7': 'primary-500', '0078d4': 'primary-700', '0070f3': 'primary-500',
  '0066a1': 'primary-700', '0051a8': 'primary-800', '5666f5': 'assist-600', '9333ea': 'assist-600',
  'ee3224': 'risk-600', 'a7a9ac': 'fg-400', 'ffffff': 'surface-0', 'fbfcfd': 'surface-50',
  'f97316': 'attention-600', 'c2410c': 'attention-700', 'f5f3ee': 'surface-50',
  'f9f9ff': 'surface-50', 'f9fafc': 'surface-50', 'f8fafc': 'surface-50', '7e22ce': 'info-700',
  '014c8c': 'primary-solid-hover', '111827': 'fg-950', '374151': 'fg-700', '6b7280': 'fg-500',
}

const UTIL = 'bg|text|border(?:-[trblxy])?|ring|ring-offset|divide|outline|fill|stroke|from|via|to|placeholder|decoration|accent|caret|shadow'

function mapColor(util, color, step) {
  const base = util.startsWith('border') ? 'border' : util
  if (new RegExp(`^(${NEUTRAL})$`).test(color)) return neutral(base, step)
  for (const [re, f] of FAMILY) {
    if (re.test(color)) {
      const fam = f === 'assist' && !MACHINE_SURFACE.test(currentFile) ? 'info' : f
      if (step === undefined) return fam === 'primary' ? 'primary-700' : `${fam}-${fam === 'risk' || fam === 'assist' || fam === 'attention' || fam === 'info' ? 600 : 700}`
      const s = STEPS[fam][Number(step)]
      return s === undefined ? null : `${fam}-${s}`
    }
  }
  return null
}

function transformClasses(src) {
  let out = src
  // dark: overrides — the tokens already switch with the theme.
  out = out.replace(/(^|[\s"'`{(])dark:[^\s"'`)}]+/g, '$1')
  // Arbitrary hex: bg-[#015CA9], text-[#EE3224]/80
  out = out.replace(new RegExp(`\\b(${UTIL})-\\[#([0-9a-fA-F]{6})\\]`, 'g'), (m, util, hex) => {
    let t = HEX[hex.toLowerCase()]
    if (t?.startsWith('assist-') && !MACHINE_SURFACE.test(currentFile)) t = t.replace('assist-', 'info-')
    return t ? `${util}-${t}` : m
  })
  // Stock hues and cs-* brand colours.
  const hues = `${NEUTRAL}|blue|sky|green|emerald|teal|lime|red|rose|pink|amber|yellow|orange|indigo|violet|purple|fuchsia|cyan`
  out = out.replace(new RegExp(`\\b(${UTIL})-(${hues})-(\\d{2,3})\\b`, 'g'), (m, util, color, step) => {
    const t = mapColor(util, color, step)
    return t ? `${util}-${t}` : m
  })
  out = out.replace(new RegExp(`\\b(${UTIL})-(cs-primary|cs-secondary)\\b`, 'g'), (m, util, color) => `${util}-${mapColor(util, color)}`)
  out = out.replace(/\b(bg|text|border)-cs-muted\b/g, (m, u) => (u === 'text' ? 'text-fg-400' : `${u}-surface-300`))
  out = out.replace(/\b(bg|text|border)-cs-background\b/g, '$1-card')
  out = out.replace(/\bbg-white\b/g, 'bg-card').replace(/\btext-black\b/g, 'text-fg-950')
  out = out.replace(/\bborder-white\b/g, 'border-surface-0')
  // Translucent black/white: a tint of the text colour / the card, rounded to
  // Tailwind's opacity steps (bg-black/8 is silently never emitted).
  const step5 = (n) => Math.max(5, Math.round(Number(n) / 5) * 5)
  // Heavy black is a modal scrim (stays dark in both themes); light black is
  // a tint of the text colour, which lightens instead in dark mode.
  out = out.replace(/\b(bg|border|ring|divide)-black\/(\d{1,2})\b/g, (m, u, a) =>
    u === 'bg' && Number(a) >= 30 ? `bg-scrim/${step5(a)}` : `${u}-fg-950/${step5(a)}`)
  out = out.replace(/\b(bg|border|ring|divide)-white\/(\d{1,2})\b/g, (m, u, a) => `${u}-surface-0/${step5(a)}`)
  out = out.replace(/\bshadow-inner\b/g, '')
  // Elevation onto the e-scale.
  out = out.replace(/\bshadow-sm\b/g, 'shadow-e1').replace(/\bshadow-(md|lg)\b/g, 'shadow-e2').replace(/\bshadow-(xl|2xl)\b/g, 'shadow-e3')
  out = out.replace(/(["'`\s])shadow(?=["'`\s])/g, '$1shadow-e1')
  // ContractSense's radius scale is Tailwind's; ours is one step rounder.
  out = out.replace(/\brounded-2xl\b/g, 'rounded-xl').replace(/\brounded-xl\b/g, 'rounded-lg')
  // Display fonts collapse into the three families.
  out = out.replace(/\bfont-(syne|plus-jakarta|GullyVar|InterVar)\b/g, 'font-sans').replace(/\bfont-cormorant\b/g, 'font-serif')
  // Page titles use the platform's title step (22px, weight and tracking
  // built in), so a ported page's heading matches a lifecycle page's.
  out = out.replace(/(["'`])([^"'`\n]*\btext-(?:2xl|3xl)\b[^"'`\n]*)\1/g, (m, q, cls) => {
    const next = cls
      .replace(/\b(?:md:|sm:|lg:)?text-(?:2xl|3xl|4xl)\b/g, '')
      .replace(/\b(?:font-bold|font-semibold|tracking-tight)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return `${q}text-title${next ? ` ${next}` : ''}${q}`
  })
  // A fill under white text must be a -solid token (numbered steps invert in dark).
  out = out
    .split('\n')
    .map((line) => {
      if (!/\btext-white\b/.test(line)) return line
      return line
        .replace(/\bhover:(bg|border)-(primary|success|risk|assist|info|attention)-(700|800|900)\b/g, 'hover:$1-$2-solid-hover')
        .replace(/(^|[\s"'`])(bg|border)-(primary|success|risk|assist|info|attention)-(500|600|700|800)\b/g, '$1$2-$3-solid')
        .replace(/\bbg-fg-(950|700)\b/g, 'bg-primary-solid')
        .replace(/\bhover:bg-fg-(950|700|400)\b/g, 'hover:bg-primary-solid-hover')
    })
    .join('\n')
  return out
}

/*
 * Wording. A ContractSense project and a draftLegal matter are one thing in
 * the merged product, and it is called a Space. Only what a user reads is
 * rewritten — never an id, a path, a field name or a console log — so this is
 * an explicit list rather than a blanket rename.
 */
const WORDING = [
  ['All Projects', 'Spaces'],
  ['Manage your projects and access all associated documents and tools.', 'Manage your spaces and the documents and tools in them.'],
  ['New Project', 'New space'],
  ['New project', 'New space'],
  ['Search projects...', 'Search spaces…'],
  ['Project Memory', 'Space memory'],
  ['Project Assistant', 'Space assistant'],
  ['Project created', 'Space created'],
  ['Could not create project', 'Could not create space'],
  ['Project roles updated', 'Space roles updated'],
  ['Could not save project roles.', 'Could not save space roles.'],
  ['Failed to load project details', 'Failed to load space details'],
  ['This project is not available in the current context.', 'This space is not available in the current context.'],
  ['Projects unavailable', 'Spaces unavailable'],
  ['Project Unavailable', 'Space unavailable'],
  ['No project history yet', 'No history in this space yet'],
  ['Nothing has happened in this project yet.', 'Nothing has happened in this space yet.'],
  ['Recorded in project memory', 'Recorded in space memory'],
  ['All project docs', 'All docs in this space'],
  ['Team Project', 'Team space'],
  ['Personal Project', 'Personal space'],
  ["Optional — otherwise the project&apos;s roles apply", "Optional — otherwise the space&apos;s roles apply"],
  ['Project rule sets for clause review', 'Rule sets for clause review'],
  ['this project', 'this space'],
  ['via project', 'via space'],
]

function transform(src) {
  let out = src.replace(/^\s*["']use client["'];?\s*\n/m, '')
  for (const [from, to] of WORDING) out = out.split(from).join(to)
  out = out.replace(/(from\s+|import\s*\(\s*|import\s+)(["'])@\//g, '$1$2@cs/')
  // ContractSense renders PDFs with pdf.js 4; the lifecycle screens are pinned
  // to 3 by @react-pdf-viewer. Both are installed, 4 under the alias pdfjs-v4.
  out = out.replace(/(["'])pdfjs-dist(\/[^"']*)?\1/g, '$1pdfjs-v4$2$1')
  return transformClasses(out)
}

// ── Import graph ──────────────────────────────────────────────────────────────

const EXT = ['', '.tsx', '.ts', '/index.tsx', '/index.ts']
function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = join(CS, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const e of EXT) {
    const p = base + e
    if (existsSync(p) && /\.(tsx?|css)$/.test(p)) return p
  }
  return null
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g

const entries = process.argv.slice(2)
if (!entries.length) {
  console.error('usage: node scripts/port-cs.mjs <path inside vendor/contractsense/apps/frontend> …')
  process.exit(1)
}

const queue = entries.map((e) => resolve(CS, e))
const seen = new Set()
const report = { written: [], kept: [], unchanged: [] }

while (queue.length) {
  const file = queue.shift()
  if (seen.has(file)) continue
  seen.add(file)
  if (!existsSync(file)) {
    console.error(`missing: ${relative(CS, file)}`)
    continue
  }
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(IMPORT_RE)) {
    const dep = resolveImport(file, m[1] ?? m[2])
    if (dep && !seen.has(dep)) queue.push(dep)
  }

  const rel = relative(CS, file)
  const dest = join(DEST, rel)
  currentFile = rel
  const out = transform(src)
  const prev = manifest[rel]
  if (existsSync(dest)) {
    const current = readFileSync(dest, 'utf8')
    if (!prev || sha(current) !== prev) {
      report.kept.push(rel)
      continue
    }
    if (current === out) {
      report.unchanged.push(rel)
      continue
    }
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, out)
  manifest[rel] = sha(out)
  report.written.push(rel)
}

writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + '\n')

console.log(`ported ${report.written.length}, unchanged ${report.unchanged.length}, kept (hand-edited) ${report.kept.length}`)
for (const f of report.written) console.log(`  + ${f}`)
for (const f of report.kept) console.log(`  = ${f}  (hand-edited, left alone)`)
