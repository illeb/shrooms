# syntax=docker/dockerfile:1

# Debian slim e non Alpine: gli engine Prisma su musl richiedono target
# specifici e non vale la pena spenderci tempo per pochi MB.
FROM node:24-slim AS base
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dipendenze (cache separata dal codice) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json          apps/api/
COPY apps/web/package.json          apps/web/
COPY packages/mycology-core/package.json  packages/mycology-core/
COPY packages/graphql-schema/package.json packages/graphql-schema/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @mushrooms/api... --filter @mushrooms/graphql-schema...

# ---- build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @mushrooms/mycology-core build \
 && pnpm --filter @mushrooms/api exec prisma generate \
 && pnpm --filter @mushrooms/api build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules            ./node_modules
COPY --from=build /app/package.json            ./package.json
COPY --from=build /app/pnpm-workspace.yaml     ./pnpm-workspace.yaml
COPY --from=build /app/packages                ./packages
COPY --from=build /app/apps/api/node_modules   ./apps/api/node_modules
COPY --from=build /app/apps/api/dist           ./apps/api/dist
COPY --from=build /app/apps/api/package.json   ./apps/api/package.json
COPY --from=build /app/apps/api/prisma         ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts

# Gli script dello scheduler: stessa immagine dell'API, comando diverso. Una
# sola immagine da costruire e da tenere aggiornata, e la certezza che il cron
# esegua esattamente il codice che gira in produzione.
COPY docker/scheduler/ ./docker/scheduler/

RUN chmod +x /app/docker/scheduler/*.sh

WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
