# Website responsiveness follow-up

## Changes

- Browser API client shares simultaneous identical GET requests, including development Strict Mode duplicates. Entries are removed on settlement; mutations invalidate pending-read lookup both before and after completion. This is not persistent response caching and is disabled for server calls and custom-header/abortable requests.
- Weekly schedule loads the weekly occurrences once and derives each selected day's tasks from it. Selecting another day in that same loaded week does not refetch. Switching weeks, resetting Demo or saving changes still loads fresh data. Request generation guards reject late responses from a previously selected week.
- Calendar week view derives selected-day occurrences from the week response instead of fetching the same day separately.
- Home/schedule dialogs, home task composer, weekly calendar grid, calendar event dialog and doctor aftercare panel load on demand. Doctor hospital/aftercare tabs skip the unrelated 90-day appointment request.

## Measurements and checks

On the same local development server at port 3001, initial browser API request counts changed from schedule 9 to 4, calendar month 9 to 5 and doctor appointments 5 to 3. Switching all seven loaded days caused zero API requests; switching to another week caused two data requests. The browser reported zero page errors in that regression check.

Page-load timings in development varied with compilation and are not suitable as production latency guarantees. No production speed percentage is claimed. Gemini provider latency/quota is independent of these changes.

`scripts/performance-smoke.cjs` checks request counts and week switching. `tests/api-client-performance.test.ts` checks in-flight-only reuse and mutation/account-boundary invalidation. Task scheduler and aftercare browser smoke tests also cover the deferred panels. Synthetic responses are used for AI tests; performance checks do not spend AI quota.

No Git push/merge, hosted database changes, or persistent private-data cache was introduced.

## Menu transition follow-up

- The shell now mounts in the root layout and survives internal route changes. Existing page-level wrappers detect the parent shell and do not nest another shell. Shell state is keyed by account/mode, while login, registration and public share pages stay outside it.
- A route loading boundary provides content feedback without replacing navigation. Hover/focus/touch intent prefetches the target menu route.
- `npm run dev` now uses Turbopack, verified on an isolated development server and then restarted at port 3001. `npm run dev:webpack` retains the alternate development runner. `CAREPLAN_DIST_DIR` permits isolated verification builds without overwriting the user's active development output.
- `scripts/navigation-smoke.cjs` clicked nine menu transitions, verified sidebar DOM identity, zero notification reloads, no duplicate navigation, correct public-route boundaries and zero browser errors. Development measurements varied: warmed transitions were 113–133 ms with Webpack and 254–595 ms in the isolated Turbopack run; first visits in that Turbopack run were 388–1186 ms. These were different compilation/cache states, so they do not establish a general speedup percentage.
- The same navigation, week-selection, scheduler and aftercare browser checks passed on the restarted port 3001. AI UI checks used fixtures and did not consume provider quota.
- Isolated production build passed compilation, lint, type validation and prerendering. Its port-3109 preview passed the nine-transition browser check in 58–70 ms per route commit/visible heading, with zero notification reloads and zero page errors. This measures local menu navigation, not completion of all data requests or Gemini generation. The production preview is left available for user testing; development remains on port 3001.
