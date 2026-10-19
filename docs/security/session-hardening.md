# Session hardening rollout

The browser now keeps the signed LMS session in an `HttpOnly`, `SameSite=Lax`
cookie (`Secure` and `__Host-` prefixed in production). Local storage retains
only the display profile. Existing token-bearing local sessions are exchanged
for the cookie by the next successful session refresh, then removed from local
storage. Sign-out revokes the current session and clears the cookie.

Login and PIN failure counters now use the database so they are shared between
serverless instances. Bucket identifiers are SHA-256 hashed before storage.
Rate-limit RPCs are restricted to `service_role`; application login fails
closed if those RPCs are unavailable.

## Rollout

1. Apply `20261018000008_shared_auth_rate_limits.sql` to each database before
   deploying the application code. Without it, sign-in intentionally fails
   closed instead of silently falling back to instance-local limits.
2. Deploy the application. Existing sessions migrate on their next refresh;
   users with stale or revoked sessions will need to sign in again.
3. Verify PIN/password sign-in, RFID sign-in, refresh after page reload,
   sign-out revocation, and that `miow-lms-session` no longer contains a token.
4. Review deployment logs for `[auth] login rate limit reached`; the bucket
   identifier in that event is a hash and does not contain an email or student
   ID.

Run `bun run scripts/test-auth-rate-limit-migration.mts` to exercise the SQL
attempt ceiling and failure-counter reset against PGlite.
