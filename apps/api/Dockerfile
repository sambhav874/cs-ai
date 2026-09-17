# syntax=docker/dockerfile:1.7
#
# Cloud Run image for apps/api.
#
# Why tsx at runtime rather than `tsc → node dist/`?
# As of Wave 0.3 (2026-07) `pnpm --filter api build` compiles cleanly (the old
# nodemailer / Prisma-JSON / ioredis type errors are fixed and typecheck is green
# in CI). The remaining blocker to a compiled image is packaging: `@clm/types`
# still resolves its `main`/`exports` to `src/index.ts`, so `node dist/index.js`
# would import TypeScript at runtime. Switching to a compiled build is tracked in
# Wave 4 (deployment) — it needs `@clm/types` to emit JS + conditional exports,
# then a Docker-build smoke test. Until then, `tsx` matches the `pnpm dev` path
# one-to-one and is a supported way to run TS on Cloud Run.

# ---------- deps stage ----------
FROM node:20-slim AS deps
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=1
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/

RUN pnpm install --frozen-lockfile

# ---------- build stage ----------
# Generates the Prisma client and copies source. No tsc step.
FROM deps AS build
WORKDIR /repo
COPY packages/types/ packages/types/
COPY apps/api/ apps/api/

RUN pnpm --filter api exec prisma generate

# ---------- runtime stage ----------
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodejs
WORKDIR /app

# Bring over node_modules (workspace) + Prisma client + source.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/types ./packages/types
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/src ./apps/api/src
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN chown -R nodejs:nodejs /app
USER nodejs
WORKDIR /app/apps/api
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--import", "tsx", "src/index.ts"]
