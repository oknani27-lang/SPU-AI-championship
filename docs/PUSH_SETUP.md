# Calendar Web Push

The new calendar stores and schedule remain the source of truth. This feature sends **calendar event** reminders using Web Push, separate from the existing care-task in-app reminder engine. Demo mode never registers devices or sends real Push. None of these changes deploy a worker, apply a hosted migration or send a real notification automatically.

## Configure Live

1. Apply the existing CarePlan schema/calendar migrations, then `20261125000100_careplan_web_push.sql`. The push migration was generated with `supabase migration new` and moved after the repository's legacy eight-digit migration filenames so initialization order is correct.
2. Keep server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and existing authentication settings. Generate stable VAPID keys with `npx web-push generate-vapid-keys --json`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<your-team-contact>` in the API and worker environments. Never expose the private key.
3. Serve over HTTPS (localhost works in development). Open settings in a Live account and enable Push on each device. Permission alone does not enroll the device. On iPhone/iPad, install the website as a compatible Home Screen web app.
4. Run a persistent process with the same environment: `node --import tsx scripts/calendar-worker.ts`. It loads `.env.local` then `.env` without replacing process variables. Alternatively run `node --import tsx scripts/calendar-worker.ts --once` at least once per minute. Use a process manager; do not place the continuous worker in a Vercel request. A 15-minute cron is too infrequent for 5-minute advance reminders.

The worker checks every 30 seconds. It sends the selected advance reminder and start reminder (a zero-minute reminder sends once). Setting no reminder disables both. Reminder preferences and quiet hours apply; custom calendar reminders are independent of rest days in the weekly care plan. Devices require connectivity and browser/OS support. Delivery is best effort; reminders older than ten minutes are skipped after downtime.

Durable database claims prevent overlapping workers from sending the same delivery. Transient failures retry up to five attempts; expired endpoints are removed. A provider acknowledgement followed by a database outage may cause retry, so stable notification tags also replace visible duplicates. Already queued messages cannot be recalled after an event edit. Retain delivery rows for deduplication; an optional maintenance task can remove rows older than 30 days.

Clicking a notification opens `/calendar?event=<id>&date=<occurrence-date>`. Signing out removes the current browser subscription first; cleanup failure must be surfaced instead of silently signing out and leaving a shared device enrolled. Other devices stay enrolled.

## Verify before production

Run tests and apply the migration to an isolated database. In Live, create an event shortly ahead, enable Push, close its tab, and verify receipt and click navigation. Run the worker twice to test deduplication; test two accounts, quiet hours and an expired endpoint. Run Supabase security advisors after hosted migration. Local automated tests do not verify device delivery, hosted permissions or the scheduler's availability.

References: [Web Push library](https://github.com/web-push-libs/web-push), [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
