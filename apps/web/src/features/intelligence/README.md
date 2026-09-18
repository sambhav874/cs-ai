# features/intelligence

ContractSense's screens, ported from its Next.js app
(`vendor/contractsense/apps/frontend`) into this SPA — merge runbook step 5.
Imported as `@cs/…`.

## How a screen comes in

```bash
node scripts/port-cs.mjs app/tabular-reviews/page.tsx
```

The script follows every import from the entry, copies the reachable tree here
and rewrites it: `@/` → `@cs/`, stock Tailwind colours → cs-ai tokens by
meaning, page titles → `text-title`, `dark:` overrides dropped (tokens switch
with the theme), pdf.js 4 → the `pdfjs-v4` alias. Then add a route in
`routes.tsx`, and run `pnpm typecheck` and `pnpm lint:ds`.

Re-running is safe: `.ported.json` holds a hash of what the script wrote, and a
file edited by hand since is left alone.

## Adapters (hand-written, never overwritten)

| File | Replaces | Does |
| --- | --- | --- |
| `shims/next-*.tsx` | `next/link`, `next/navigation`, `next/dynamic`, `next/image` | react-router equivalents; aliased in `vite.config.ts` and `tsconfig.json` |
| `shims/href.ts` | ContractSense's URLs | maps them onto the SPA's (`/dashboard/projects/:id` → `/projects/:id`) |
| `lib/apiClient.ts` | cookie + CSRF session | the platform access token as a Bearer header, one refresh on 401 |
| `components/auth/SecureApiProvider.tsx` | same | adds that header to raw `fetch`/axios calls to `/intel/…` |
| `hooks/useAuth.tsx` | ContractSense sign-in | the SPA's login (`store/auth`) |
| `app/context/AccountContext.tsx` | personal/team switcher | always the user's organisation's team (`/users/me` → `teamIds[0]`) |
| `app/context/BreadcrumbContext.tsx` | its header crumbs | the SPA's breadcrumb bar (`store/crumbs`) |
| `hooks/use-toast.ts` | shadcn toasts | the SPA's one Toaster |
| `components/ui/{button,input,label}.tsx` | its primitives | the platform's, so both halves share one button and field |
| `components/ui/{badge,card}.tsx` | its primitives | restyled onto the platform's pill and card |

The intelligence API is reached at `/intel/api/v1` — proxied to
`apps/intelligence` by Vite in development and by nginx when deployed.
Identity is `apps/intelligence/core/platform_identity.py`.

## Ported so far

- Projects (`/projects`) and a project (`/projects/:projectId`), with its
  contracts, timeline and **project memory** panel.

Unused code carried over from ContractSense lints as a warning here, not an
error (`eslint.config.mjs`); clean it as each screen is touched.
