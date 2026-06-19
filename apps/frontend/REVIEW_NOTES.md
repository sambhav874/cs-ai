# Frontend Code Review — June 2026

## 🔴 Critical

| # | Issue | File | Fix |
|---|-------|------|-----|
| C1 | No `middleware.ts` — auth gating is client-side only, flash-of-protected-content before redirects | `app/` | Create `middleware.ts` with cookie-based session check |
| C2 | `formidable` in frontend deps — server-side multipart parser, could leak server code | `package.json` | Remove immediately |
| C3 | `Content-Type` typo: `application/x-www-form-urlencoded` (missing "ren") | `app/signin/page.tsx` | Fix to `application/x-www-form-urlencoded` |
| C4 | Zero `loading.tsx` or `error.tsx` files — no Suspense boundaries, no error recovery | All routes | Add `loading.tsx` + `error.tsx` to every route segment |
| C5 | `window.fetch` monkey-patched globally — breaks third-party fetch calls | `components/auth/SecureApiProvider.tsx` | Replace with `secureFetch()` wrapper |

## 🟠 High

| # | Issue | File | Fix |
|---|-------|------|-----|
| H1 | ~50MB dead/duplicate deps: `@tensorflow/*`, `@barba/core`, `cobe`, `gsap`, `@react-pdf/renderer`, `styled-components`, `@wojtekmaj/react-hooks` | `package.json` | Remove unused deps |
| H2 | 4 PDF libs, 5 date libs, 2 animation libs (`framer-motion` + `motion`), 2 charting libs | `package.json` | Consolidate to 1 per category |
| H3 | `strict: false` in tsconfig — no null checks, implicit `any` | `tsconfig.json` | Enable `strict: true` incrementally |
| H4 | 1373-line monolithic `app/page.tsx` blocks code splitting | `app/page.tsx` | Decompose into section components, lazy-load with `next/dynamic` |
| H5 | `images: { unoptimized: true }` disables all image optimization | `next.config.ts` | Remove or scope to specific domains only |
| H6 | No `@tanstack/react-query` — manual fetch with ad-hoc in-memory caching | All data fetching | Add React Query for deduplication, cache, retry |

## 🟡 Medium

| # | Issue | File | Fix |
|---|-------|------|-----|
| M1 | Route gating via hardcoded `noLayoutPages` array — fragile | `components/client-layout.tsx` | Use Next.js Route Groups `(marketing)` / `(app)` |
| M2 | Duplicate `contractData` arrays in `HeroAnimation` and `Home` | `app/page.tsx` | Single source of truth |
| M3 | Sidebar refetches data on every route change (depends on `pathname`) | `components/Sidebar.tsx` | Remove `pathname` from useEffect deps |
| M4 | `react-pdf` CSS imported globally in root layout | `app/layout.tsx` | Import only where PDF is rendered |
| M5 | Inline `<style>` with `@keyframes` in JSX — renders per-instance | `app/page.tsx` | Move to `globals.css` |
| M6 | Custom cursor `requestAnimationFrame` runs continuously | `app/page.tsx` | Pause when mouse idle, respect `prefers-reduced-motion` |
| M7 | Hardcoded CSP directives instead of env-conditional | `next.config.ts` | Gate `unsafe-eval`/`unsafe-inline` to dev only |
| M8 | No `not-found.tsx` custom 404 | `app/` | Add custom 404 page |

## 🟢 Low

| # | Issue | File | Fix |
|---|-------|------|-----|
| L1 | `suppressHydrationWarning` on `<body>` — hides genuine mismatches | `app/layout.tsx` | Remove from body, keep on html only |
| L2 | `@types/react@19.1.0` pinned while `react@^19.0.0` | `package.json` | Match versions |
| L3 | Duplicate `contractData` in `HeroAnimation` and `Home` with slightly different shapes | `app/page.tsx` | Consolidate |

## ♿ Accessibility

| # | Issue | Fix |
|---|-------|-----|
| A1 | No skip-to-content link | Add in root layout |
| A2 | Custom cursor replaces native cursor | Remove or make opt-in + respect `prefers-reduced-motion` |
| A3 | No `aria-label` on icon-only buttons (collapsed sidebar) | Add `aria-label` to all icon links |
| A4 | No visible focus indicators on marketing page | Add `focus-visible:` rings |
| A5 | No `role`/`aria-expanded` on collapsible sidebar sections | Add ARIA states |
| A6 | Color contrast below 4.5:1 on low-opacity text (`rgba(10,10,15,0.3)`) | Increase opacity or adjust colors |
| A7 | No `aria-live` regions for async updates (toasts, streaming, job status) | Add `aria-live="polite"` |
| A8 | Mobile menu doesn't trap focus | Add focus trap |
| A9 | Demo video has no captions/transcript | Add text alternative |

---

# Design & UI/UX Audit — June 2026

Benchmarks: Linear, Vercel, Notion

## 🎨 Design System

| # | Issue | Severity |
|---|-------|----------|
| D1 | **Three competing color systems**: Landing page hardcoded hex (`#0a0a0f`/`#f5f3ee`/`#0078d4`), shadcn stone (`gray-50` → `gray-950`), and unused custom props (`--ink`/`--paper`/`--azure`) — zero unification | 🔴 |
| D2 | **Dark mode broken for dashboard + landing page**: Dashboard uses literal `bg-gray-50`/`text-gray-950` (not semantic `bg-background`/`text-foreground`). Landing page uses hardcoded color classes. Only shadcn primitives survive dark mode | 🔴 |
| D3 | **Landing page has 100+ inline `style={{}}` objects** — no design token enforcement, impossible to refactor consistently | 🟠 |
| D4 | **23 distinct font sizes** on landing page (8px → 140px), no type scale — Linear uses 8-10 sizes on a modular ratio | 🟠 |
| D5 | **Agent components use slate** while dashboard/shadcn uses gray — two visual languages in the same product | 🟡 |
| D6 | **Border-radius inconsistency**: `rounded-xl` (shadcn), `rounded-lg` (agent), `rounded` (citations), `rounded-sm` (landing cards) | 🟡 |
| D7 | Native `<select>` elements everywhere instead of shadcn Select — looks unfinished | 🟡 |
| D8 | Status pills use inline color classes (`bg-yellow-100 text-yellow-800`) — no centralized badge variant system | 🟡 |

## 🔤 Typography

| # | Issue | Severity |
|---|-------|----------|
| T1 | **Two fonts write to `--font-cormorant`**: `Cormorant_Garamond` (layout.tsx) and `Plus_Jakarta_Sans` (page.tsx) — they fight over the same CSS variable | 🔴 |
| T2 | **10 total font families loaded**: 5 Google Fonts (layout) + 2 more Google Fonts (landing) + 3 custom `@font-face` (InterVar, GullyVar) | 🟠 |
| T3 | `InterVar` — the UI font actually used — is declared in `@font-face` but **never mapped as default sans in tailwind.config.ts**. Body falls back to Arial/Helvetica | 🟠 |
| T4 | ~300KB+ of font payload, slow LCP | 🟠 |

## ✨ Motion & Animation

| # | Issue | Severity |
|---|-------|----------|
| AN1 | **No `prefers-reduced-motion` media query anywhere** — 8+ `@keyframes` and Framer Motion animations ignore user preference. WCAG 2.1 AA failure | 🔴 |
| AN2 | **Custom cursor replaces native cursor** — breaks accessibility, reads as "design portfolio" not "enterprise product" | 🔴 |
| AN3 | **`text-shining` gradient animation** — gaudy, reads like a crypto scam page | 🟠 |
| AN4 | **Three animation systems coexist**: Framer Motion, raw CSS `@keyframes`, and custom `requestAnimationFrame` loops | 🟡 |
| AN5 | `animate-ticker` runs infinitely, no pause-on-hover — usability anti-pattern | 🟡 |
| AN6 | Unused keyframes in globals.css: `pulseBorder`, `hide`, references to undefined `shimmer-slide` | 🟢 |

## 📱 Responsive & Mobile

| # | Issue | Severity |
|---|-------|----------|
| R1 | Contract explorer uses `min-w-[980px]` — **overflows on iPad** and below | 🔴 |
| R2 | Contract detail page is **6862 lines** in one file — impossible to audit for responsive bugs | 🟠 |
| R3 | Dashboard page is **2567 lines** with no component decomposition | 🟠 |
| R4 | Sidebar mobile slide-over with Framer Motion spring is well done ✓ | ✅ |
| R5 | Landing page uses `clamp()` for hero typography ✓ | ✅ |

## 🧩 UX Patterns

| # | Issue | Severity |
|---|-------|----------|
| U1 | **No error boundary or inline error recovery UI** — failures surface only as toasts, no "Try Again" pattern | 🟠 |
| U2 | **Loading screens exist but are ad-hoc** — skeleton component only pulses `bg-primary/10`, too subtle with no content-shape matching | 🟡 |
| U3 | `ColabsHeader` overloaded: file upload + account switcher + AI provider selector + credits + logout — too many actions in one bar | 🟡 |
| U4 | KPI register shows 7 columns + multiple actions at once — Notion hides actions behind hover for progressive disclosure | 🟡 |
| U5 | All dashboard data fetches eagerly — no lazy loading behind tabs | 🟡 |
| U6 | Empty states for KPI register and contract explorer are solid ✓ | ✅ |
| U7 | `CitationHoverCard` + `ReActThinkingStream` + `AgentTraceView` are genuinely well-designed progressive disclosure patterns ✓ | ✅ |

## 🌓 Theming Implementation

| # | Issue | Severity |
|---|-------|----------|
| TH1 | `--ink`/`--paper`/`--azure` custom props defined in `globals.css` but **never consumed by any Tailwind class** — dead code | 🟠 |
| TH2 | `ThemeProvider` setup is correct but the entire app ignores it via hardcoded colors | 🟠 |
| TH3 | Dark mode CSS variables properly defined in `.dark` block but only shadcn primitives reference them | 🟡 |

## 🏆 What's Genuinely Good

- **R3F hero shader** — data-grid + scanning pulse + mouse ripple is exceptional and memorable
- **Color palette choice** (`#0a0a0f` / `#f5f3ee` / `#0078d4`) — distinctive, premium, stands out from the blue-purple SaaS monoculture
- **Editorial typography** — Cormorant italic headlines create the right high-end legal/finance feel
- **Dot-grid decorative elements** and `gap-px` grid borders on suite cards — tasteful Linear-inspired touches
- **Collapsible agent trace components** — excellent progressive disclosure for AI internals

## 🔺 Top 10 Design Issues (Ranked)

| Rank | Issue | Category |
|------|-------|----------|
| 1 | Dark mode broken everywhere except shadcn primitives | Theming |
| 2 | Three competing color systems, no unification | Design System |
| 3 | Two fonts fighting over `--font-cormorant` CSS variable | Typography |
| 4 | No `prefers-reduced-motion` support — WCAG AA failure | Accessibility |
| 5 | Custom cursor + `text-shining` — enterprise product looks like a portfolio | Motion |
| 6 | Contract page: 6862 lines, one file — unmaintainable | Architecture |
| 7 | Landing page: 100+ inline `style={{}}`, no design tokens | Design System |
| 8 | 10 font families loaded, ~300KB payload | Performance |
| 9 | Agent components use slate, dashboard uses gray — two visual languages | Cohesion |
| 10 | `min-w-[980px]` table — broken on iPad | Responsive |
