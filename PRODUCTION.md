# Production deployment

The owner has authorized public Production deployment. The API accepts both Preview and Production while retaining shared Supabase budgets, host/origin checks and Secure/HttpOnly/SameSite cookies. No UI or AI scope is changed.

Set these in Vercel **Production** (and Preview if desired): GEMINI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY. Replace the Gemini and Supabase server keys exposed in screenshots first. Never include the NAME= prefix in the Value field.

Set APP_ORIGIN to the exact final public HTTPS origin (no trailing slash/path) if the platform does not supply VERCEL_PROJECT_PRODUCTION_URL or when using an additional custom hostname. The unique deployment hostname from VERCEL_URL remains accepted. Arbitrary vercel.app hosts are not trusted.

Run supabase/migrations/20261119_preview_limits.sql once if it has not already been applied. Despite its filename, these shared limits also protect Production. Missing limit RPCs fail closed with 503. Preview and Production in the same Supabase database share daily budgets.

Set Supabase Auth Site URL and allowed email redirect URL to the final public origin and its /#/login return URL. Real email confirmation, two-user RLS isolation and persisted Gemini conversations still need live verification before inviting public users. No migration is automatically applied by this code change.
