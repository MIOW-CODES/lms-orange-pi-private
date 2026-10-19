# Build with the repository's Bun release so local and container runtimes match.
FROM oven/bun:1.4.0 AS builder
WORKDIR /app

ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_API_KEY
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_GOOGLE_API_KEY=${VITE_GOOGLE_API_KEY}

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# The migration service needs pg plus the native migration runner and SQL files.
# The app image shares this stage but never receives MIGRATOR_DATABASE_URL.
FROM oven/bun:1.4.0-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/.output ./.output
COPY --chown=bun:bun scripts/migrate.ts ./scripts/migrate.ts
COPY --chown=bun:bun scripts/bootstrap-admin.ts ./scripts/bootstrap-admin.ts
COPY --chown=bun:bun db/migrations ./db/migrations
RUN mkdir -p /app/storage && chown bun:bun /app/storage

USER bun
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
