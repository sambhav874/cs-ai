# packages/types

One source of truth for shapes across two languages. TypeScript types are
consumed directly by `apps/api` and `apps/web`; the Python Pydantic models in
`apps/intelligence` are **generated** from the same source rather than
hand-kept in parallel.

That matters because seven of the sixteen collections are written by both
tiers. Where the TypeScript client and the Python model can diverge, they will,
and a validator that disagrees with its client is worse than no validator.

Source: `vendor/draft-legal/packages/types`.
