# apps/web

One frontend. The shell is a Phase 0 decision, made by counting the screens
each side keeps — default is draftLegal's Vite SPA on React 19, with
ContractSense's screens ported in.

Both sides are React with Radix, shadcn, Tailwind and React Query, so
components move either way. draftLegal brings 35 pages, the TipTap editor,
agent home and admin, and self-hosts as static files behind the same nginx
that fronts both APIs. ContractSense brings 94 client components (0 server
actions, 0 route handlers), which is what makes the Next.js features it uses
shallow enough to port.

Source: `vendor/draft-legal/apps/web`, `vendor/contractsense/apps/frontend`.
