# AGENTS.md

## Project overview

MIOW (MSU-IIT IDS Online Workspace) is a learning management system built with TanStack Start, React 19, TypeScript, Tailwind CSS, and native PostgreSQL.

## Architecture

- **Framework**: TanStack Start SSR, Vite, and Nitro.
- **UI**: React, Tailwind CSS, shadcn/ui components, and Framer Motion.
- **Database**: one native PostgreSQL connection path using pg; no provider autodetection.
- **Authentication**: application-owned signed HMAC sessions and bcrypt-hashed PINs, stored and checked by server modules.
- **Uploads**: persistent local filesystem storage served through authorized application routes.
- **Testing**: bun:test, Playwright, and native PostgreSQL integration checks.

## Key directories

- src/routes: file-based TanStack routes and server endpoints.
- src/components: UI and course components.
- src/hooks: client hooks.
- src/lib/server: server-only domain logic and authorization.
- src/lib/lms.ts: client wrappers for server functions.
- src/lib/lms.functions.ts: validated TanStack server functions.
- src/integrations/db: PostgreSQL pool/query layer and local file storage.
- db/migrations: native PostgreSQL migration chain.
- scripts: migration, seeding, import, and maintenance commands.
- tests/integration: database behavior checks.
- tests/e2e: Playwright browser checks.

## Commands

- bun run dev
- bun run build
- bun run lint
- bun run typecheck
- bun run test
- bun run test:integration
- bun run test:e2e
- bun run db:up
- bun run db:migrate

## Code conventions

- Keep server-only files suffixed with .server.ts.
- Keep database access and authorization in server modules.
- Client code uses @/lib/lms; it must not import server modules directly.
- Validate server-function inputs with schemas in src/lib/server/schemas.server.ts.
- Use parameterized PostgreSQL queries. The internal query helper is native PostgreSQL only; do not restore compatibility with a hosted data API.
- Keep migrations schema-focused, uniquely identified, repeatable through the migration ledger, and free of personal records or credentials.
- Never place secrets or real learner/staff records in source, tests, build arguments, or committed artifacts.

## Database and security

- DATABASE_URL is for the non-owner application role.
- MIGRATOR_DATABASE_URL is for the separate schema owner used only by the migration command.
- The application enforces row ownership and role checks in server code; do not add pooled-session identity state.
- Use a unique SESSION_SECRET; no production fallback is permitted.
- Run migrations only through bun run db:migrate. Do not add hosted-service migration workflows.
- Keep PostgreSQL off public interfaces and the reverse-proxy network.
- Use the plan file for audit findings, rollout gates, and Orange Pi deployment instructions.
