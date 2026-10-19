# Repository caveats

This project is being converted to a native PostgreSQL deployment. Use synthetic data for development and CI; do not add real learner, staff, credential, or attendance records to source, fixtures, logs, screenshots, or releases.

- The checked-in native migration set is the source of truth for fresh installations. Migrations define schema and application functions only; provision any first administrator through a private one-time operator process.
- The application authenticates users with its signed-session and PIN flow. PostgreSQL stores LMS records; uploaded files live on persistent local storage.
- The application connection must use a non-owner role. Apply migrations with the separate migration-owner connection.
- The Orange Pi, PostgreSQL 16, browser account-switch behavior, external DNS, Nginx Proxy Manager routing, backups, and restore process require verification on the target environment before public rollout.
- Do not expose PostgreSQL to the internet. Keep the application reachable only through the reverse-proxy network and the LMS port bound to the private network.
- Treat imported databases and uploads as sensitive. Keep exports, backups, credentials, and real records outside Git and build contexts.
- The implementation plan records findings, acceptance criteria, domain setup, and deployment steps in ORANGE_PI_DEPLOYMENT_PLAN.md.

Review these caveats after the native database and deployment changes are complete.
