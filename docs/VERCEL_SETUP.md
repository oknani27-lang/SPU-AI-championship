# Vercel deployment

Project: `spu-ai-championship`, team `wunjokpy-6390`.

Website branding is `Careplan`. Canonical URL: https://spi-ai-careplan.vercel.app. The app is intended to be reachable without Vercel sign-in; application account checks still protect private user data.

The dashboard confirms the database belongs to `oknani27-lang's Org` and its project is named `SPU championship`; its ref matches the configured `.env` and Vercel values.

Sources are deployed through the authenticated Vercel API. Real `.env`, local data/evidence, node_modules and build outputs are excluded. Server-only application credentials are configured as sensitive Vercel environment variables for Preview and Production; local APP_BASE_URL and CAREPLAN_DIST_DIR are not copied.

## Database setup still required

The configured Supabase project is `ngkwsavxyyaeygduzvqc`. Read-only REST probes for `careplan_user_profiles` and `careplan_calendar_events` returned HTTP 404 / PGRST205. The connected Supabase account only exposes another project, which was not modified.

An owner of the intended project should run `supabase/careplan-vercel-setup.sql` once in its SQL Editor. This combines only the four CarePlan migrations in dependency order; do not run unrelated chat/preview migrations. After setup, verify the API tables and account login/registration. Configure Supabase Auth's Site URL and allowed redirects for the deployed URL where required.

Local file Demo mode is intentionally unavailable on Vercel. Its filesystem is not a durable/shared application database. The hosted demo endpoint returns an explanatory 503 instead of attempting to write local user data. The normal local development demo is unchanged.

Notifications additionally require the VAPID settings and worker setup in `docs/PUSH_SETUP.md`. The current Vercel Hobby plan rejected the existing 15-minute cron, so the web deployment does not install a scheduled cron. Use a separately hosted worker/scheduler with a server-only CRON_SECRET, or configure supported scheduling separately. The cron endpoint fails closed until authenticated. Do not infer background push readiness from a successful frontend deployment.

Public access must be verified with a fresh unauthenticated browser, without a temporary share token. Keep normal Careplan account authentication enabled.
