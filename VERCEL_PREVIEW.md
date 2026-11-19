# Bizplan — Vercel Preview preparation

## Project settings

| Setting | Value |
| --- | --- |
| Framework preset | Other (vanilla HTML/CSS/JavaScript + Node.js) |
| Node version | 24.x |
| Root Directory | Repository root `.` containing package.json and vercel.json |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | Default; no dependencies to install |
| API entry | `api/index.js`, maximum duration 60 seconds |

`vercel.json` rewrites `/api/:path*` to the Function adapter, which calls the same shared handler as the local Node server. It does not call `listen()`. The frontend keeps the existing hash routes and design. `dist` contains only index.html, app.js, account.js and styles.css. Local development still uses `npm start`.

No deployment was created, and no production configuration was applied. The owner has now authorized Production. Both Preview and Production are accepted with exact HTTPS origin checks and shared limits. Production additionally accepts VERCEL_PROJECT_PRODUCTION_URL. See PRODUCTION.md for public deployment settings.

## Environment variables

Set only in the Vercel **Preview** environment; never use NEXT_PUBLIC/VITE prefixes for secrets:

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `APP_ORIGIN` — optional exact HTTPS origin for an approved stable Preview alias (no trailing slash/path). Not needed for the unique deployment hostname.

Vercel provides `VERCEL`, `VERCEL_ENV` and `VERCEL_URL`; expose its system environment variables to Functions. No custom session signing key is required: Supabase validates access tokens, and access/refresh tokens are stored in host-only HttpOnly cookies. No passwords or test-user environment variables are needed. `.env` files and local usage data are excluded from uploads and static output.

## Required shared rate-limit migration

Run `supabase/migrations/20261119_preview_limits.sql` once in the existing Supabase project, after the chat migration. This adds **two private infrastructure tables** (request counters and expiring concurrency leases) and three service-role-only RPCs. They are necessary because Vercel instances cannot safely share local JSON files or in-memory counters. No chat records or users are changed. Existing chat tables and RLS policies remain unchanged.

The migration is prepared but has NOT been applied or tested against PostgreSQL by Codex. Inspect existing object names before applying. The management connector previously denied access. If this migration/key is missing, Preview Auth/AI requests return 503 rather than bypassing limits.

Shared limits preserve 20 Auth requests/minute/IP, 5 AI requests/minute/IP, 30 AI attempts/day/IP, 100 AI attempts/day globally, one concurrent request per IP and two globally. Session ownership is checked in the reservation RPC too. IPs are HMAC-hashed before storage. Reservations are atomic under a transaction lock; abandoned leases expire after 120 seconds. Counters expire through request-time cleanup. Completed failed API attempts count toward the budget. These are attempt/token bounds, not a precise currency budget; provider-side billing controls still apply. The local server retains its current filesystem limiter.

Supabase Auth itself handles rotating refresh tokens. In-process refresh deduplication is not shared across Function instances; keep Supabase's normal refresh-token reuse interval enabled, and verify concurrent refresh behavior in Preview before wider use.

## Cookies and callbacks

- Preview cookies: host-only, `Path=/`, `HttpOnly`, `SameSite=Strict`, `Secure`. Logout deletes cookies with matching flags. Tokens are never returned to browser JavaScript.
- CSRF checks accept only the unique `https://VERCEL_URL` origin and optional explicit `APP_ORIGIN`; no wildcard `*.vercel.app` request origin is trusted.
- Client IP comes from Vercel's forwarded-IP headers only in Vercel mode; the local server ignores those headers.
- Registration passes an email `redirect_to` URL pointing at the approved request origin's `/#/login`.
- Add the exact Preview callback/redirect URL to Supabase Auth → URL Configuration. A stable Preview alias is easier to maintain than wildcard redirects across deployments. Keep production Site URL unchanged. Confirmation links must not be redirected to localhost during Preview testing.
- This project implements email/password Auth, not OAuth providers. No new OAuth callback endpoint or login feature has been introduced. After email confirmation, users sign in with the existing form. Confirm the generated email redirect and expired-link behavior on the real Preview before calling email verification complete.

Vercel Deployment Protection may prevent email links from being opened by an unauthenticated recipient; ensure testers have appropriate Preview access. Do not disable protection for unrelated deployments.

## Validation and remaining work

Passed locally: build, syntax checks, 37 automated tests, exact four-file output, Preview handler/body parsing/routing, Host/Origin rejection, production API refusal, HTTPS cookies, email redirect construction, shared-limiter calls and fail-closed behavior. Provider calls in these tests are simulated. No Gemini request or database migration was made for this task.

Pending before an operational Preview: apply the shared-limit migration; set Preview environment values; configure exact email redirects; create a Preview deployment; then verify the actual Function bundle, routing, distributed limits (including concurrent instances), email delivery/confirmation, account sessions, real two-user RLS isolation and persistent Gemini chat. The previous real-user A/B verification is still pending and must not be represented as completed by these tests.

Documentation consulted:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/headers/request-headers
- https://supabase.com/docs/guides/auth/redirect-urls
