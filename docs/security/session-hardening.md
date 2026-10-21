# Session hardening rollout (native PostgreSQL)

The browser keeps the signed LMS session in an `HttpOnly`, `SameSite=Lax`
cookie (`Secure` and `__Host-` prefixed in production). Local storage retains
only the display profile. Existing token-bearing local sessions are exchanged
for the cookie by the next successful session refresh, then removed from local
storage. Sign-out revokes the current session and clears the cookie.

Login and PIN failure counters use the native PostgreSQL `public.auth_rate_limits`
table and rate-limit functions created by the checked-in migration chain. The
migration runner records applied migrations in `private.schema_migrations` and
configures the non-owner application role's required function privileges. The
application uses `DATABASE_URL`; schema changes use the separate
`MIGRATOR_DATABASE_URL`. This setup does not require a hosted-service role.
Bucket identifiers are SHA-256 hashed before storage, and authentication fails
closed if the database functions are unavailable.

## Rollout

1. Apply the checked-in native PostgreSQL migrations before deploying code that
   depends on them. From a development host with `.env` configured, run
   `bun run db:migrate`. On the Orange Pi, after loading the tested release
   image, start the one-shot migration service with
   `docker compose run --rm migrate`. Both paths use
   `MIGRATOR_DATABASE_URL`; the running application keeps its separate
   non-owner `DATABASE_URL`.
2. Deploy the application. Existing sessions migrate on their next refresh;
   users with stale or revoked sessions will need to sign in again.
3. Verify PIN/password sign-in, RFID sign-in, refresh after page reload, and
   sign-out revocation. Confirm `miow-lms-session` no longer contains a token
   in local storage.
4. Review logs for `[auth] login rate limit reached`. The logged bucket is a
   hash and does not contain an email address or student ID.

## Validation

Run `bun run scripts/test-auth-rate-limit-migration.mts` for the focused
synthetic PGlite checks of rate-limit ceilings, concurrent consumption, and
failure-counter reset. Run `bun run test:integration` against disposable
PostgreSQL 16 to verify the actual migration chain and runtime role privileges.
