# MIOW LMS

MIOW (MSU-IIT IDS Online Workspace) is a learning management system for junior and senior high school, built with TanStack Start, React, TypeScript, Tailwind CSS, and PostgreSQL.

## Local development

Requirements: Bun and Docker Engine with Compose.

```sh
git clone https://github.com/MIOW-CODES/lms.git
cd lms
bun install --frozen-lockfile
Copy-Item .env.example .env   # PowerShell; edit the required values
# On macOS/Linux: cp .env.example .env
docker compose up -d postgres
bun run db:migrate
bun run dev
```

Open `http://127.0.0.1:3000`. Set a unique `SESSION_SECRET` in `.env`, for example from `openssl rand -hex 32`. Never use shared/demo credentials or real student information in a development database.

## Database

The application uses **native PostgreSQL only**. Supabase services, SDKs, provider autodetection, and Supabase credentials are not supported. The server uses its custom signed-session authentication and accesses PostgreSQL using the non-owner `miow_app` role in `DATABASE_URL`. Uploaded materials and avatars use local filesystem storage under `STORAGE_PATH`.

Copy `.env.example` to `.env` and replace all password placeholders with different URL-safe random hex values. Compose provisions a one-use bootstrap superuser, a non-superuser migration-owner role, and a separate non-superuser application role when PostgreSQL starts with an empty data volume. The app container receives only the application connection string; the migration container receives only the migration connection string. Keep the host PostgreSQL port loopback-only and never expose it to the internet. The init scripts run only for an empty database volume; review and back up any existing volume before changing its role setup. See [ORANGE_PI_DEPLOYMENT_PLAN.md](ORANGE_PI_DEPLOYMENT_PLAN.md) for the Orange Pi and Nginx Proxy Manager deployment steps.

`bun run db:migrate` loads `MIGRATOR_DATABASE_URL` from `.env`, serializes migration runs, verifies migration checksums, and records each applied migration in the private schema. The clean baseline creates the schema only; it does not add users, student records, or demonstration credentials. After migrations finish, create the first administrator with `bun run db:bootstrap-admin` from the host or `docker compose run --rm migrate bun run db:bootstrap-admin` on the Pi. The command prints a randomly generated temporary password once; first login requires setting a personal PIN. Store the password securely until that login succeeds.

## Environment

See `.env.example`. Required runtime settings:

- `DATABASE_URL` — PostgreSQL connection string.
- `MIGRATOR_DATABASE_URL` — private migration-owner connection used only by migration/bootstrap commands.
- `SESSION_SECRET` — random secret used to sign session tokens.
- `STORAGE_PATH` — persistent local upload directory.

`PG_POOL_MAX` limits per-process database connections. AI and Google integrations are optional and independent from the database.

## Features

- PIN login and RFID attendance with server-side session and role checks.
- Student, teacher, and administrator dashboards.
- Course, enrollment, assignment, quiz, grading, and attendance workflows.
- Course-material and submission-file uploads.
- Optional academic assistant and Google document import.

## Commands

```sh
bun run dev
bun run typecheck
bun run lint
bun run test
bun run test:migrations
bun run test:e2e
bun run build
bun run db:up
bun run db:migrate
bun run db:bootstrap-admin
```

The default unit-test command covers `src/`. Run database integration and browser tests separately as documented by the relevant scripts/workflows.

## License

Private — MSU-IIT IDS
