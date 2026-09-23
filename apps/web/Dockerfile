# syntax=docker/dockerfile:1.7
#
# The SPA, built once and served by nginx. nginx also fronts both APIs so the
# whole app is one origin (see nginx.conf) — that is what the app assumes, and
# it means no CORS and no second hostname for the demo.
#
# Build context is the REPO ROOT, because the workspace lockfile and
# packages/types live there.

FROM node:20-slim AS build
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=1
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web... --filter .

COPY packages/types/ packages/types/
COPY apps/web/ apps/web/
# vite build only; `pnpm build` also runs tsc, which CI already did and which
# would make every deploy pay for a type-check twice.
RUN pnpm --filter web exec vite build

FROM nginx:1.27-alpine AS runtime
# A template, so the nginx image fills in the container's DNS resolver at
# start (see the resolver line in nginx.conf). Only variables present in the
# environment are substituted; nginx's own $host, $uri and so on are left alone.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/proxy-common.conf /etc/nginx/proxy-common.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/index.html >/dev/null || exit 1
