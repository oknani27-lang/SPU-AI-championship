# Vercel deployment

Project: `spu-ai-championship`, team `wunjokpy-6390`.

Website branding is `Careplan`. Canonical URL: https://spi-ai-careplan.vercel.app. The app is intended to be reachable without Vercel sign-in; application account checks still protect private user data.

The dashboard confirms the database belongs to `oknani27-lang's Org` and its project is named `SPU championship`; its ref matches the configured `.env` and Vercel values.

Sources are deployed through the authenticated Vercel API. Real `.env`, local data/evidence, node_modules and build outputs are excluded. Server-only application credentials are configured as sensitive Vercel environment variables for Preview and Production; local APP_BASE_URL and CAREPLAN_DIST_DIR are not copied.

## Database setup

The configured Supabase project is `ngkwsavxyyaeygduzvqc`. The owner has run the schema and backend grants; subsequent REST probes for the main Careplan tables returned HTTP 200. The connected Supabase account only exposes another project, which was not modified.

An owner of the intended project should run `supabase/careplan-vercel-setup.sql` once in its SQL Editor. This combines only the five CarePlan migrations in dependency order; do not run unrelated chat/preview migrations. After setup, verify the API tables and account login/registration. Configure Supabase Auth's Site URL and allowed redirects for the deployed URL where required.

Hosted Demo now creates a separate Supabase-backed sample account for each visitor without requiring an email/password form. It seeds 18 example tasks across Monday–Saturday, labels sample users/data, and uses normal secure Supabase session cookies. Existing browser demo sessions are reused; account creation has a backend hourly budget. No auth token or generated password is returned in the JSON body. Local development continues to use the original file Demo store. Hosted demo requires the deployed Careplan schema and backend grants.

Notifications additionally require the VAPID settings and worker setup in `docs/PUSH_SETUP.md`. The current Vercel Hobby plan rejected the existing 15-minute cron, so the web deployment does not install a scheduled cron. Use a separately hosted worker/scheduler with a server-only CRON_SECRET, or configure supported scheduling separately. The cron endpoint fails closed until authenticated. Do not infer background push readiness from a successful frontend deployment.

Public access must be verified with a fresh unauthenticated browser, without a temporary share token. Keep normal Careplan account authentication enabled.

If tables exist but the backend reports permission denied, run only `supabase/migrations/20261125000200_careplan_api_grants.sql`. It grants backend access to Careplan tables and restricts the completion RPC to the backend; it does not open user data to anonymous visitors.
