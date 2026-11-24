# Calendar and doctor integration verification

Based on team `origin/main` commit `59c6284`, branch `codex/integrate-calendar-v2`.

Validated locally on 24 November 2026:

- `npm run lint` and `npm run typecheck`: passed.
- `npm test`: 30 tests passed, including existing care scheduling workflows, recurrence rules, atomic store calls, owner checks and Web Push.
- `npm run build`: passed, including static `/calendar` and `/doctor` pages and new Push API routes.
- `npm run test:features`: passed against both dev and production servers. Uses real Demo login/storage APIs, creates and deletes its test appointments, verifies doctor form -> stored event -> appointment page -> calendar deep link, recurring future split, invalid input, responsive widths 390/768/1440 and Demo Push isolation. No browser runtime errors.
- Isolated PostgreSQL 16: new calendar and Push migrations executed. Verified rollback on invalid split, retained doctor type, owner isolation, RLS, service-only RPC execution, rejected endpoint takeover and duplicate delivery claim suppression. The test container was removed afterward. Supabase-specific base tables/auth were minimally bootstrapped for these SQL checks.

Not verified: hosted Supabase migrations/permissions, actual hospital booking/contact data, physical-device Push delivery, or deployed worker availability. No hosted database changes, deployment, Git merge or push were performed. Hospital/aftercare/medication screens deliberately remain labelled mockups.

Live setup requires the two additive migrations and VAPID/worker configuration described in [PUSH_SETUP.md](PUSH_SETUP.md). The previous Bizplan work remains in the named Git stash.
