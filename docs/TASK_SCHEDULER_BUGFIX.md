# Task extraction and scheduling fixes

## Reproduction

Use `scripts/fixtures/daily-tasks.txt`, the synthetic daily routine reported in the screenshot. Previously the text-to-task provider used its default 12-second deadline; fallback lost task titles before times, ignored explicit durations, merged chores, and emitted repeated missing-time warnings. A broad medicine keyword also matched the word คุณยาย.

## Changes

- Extraction uses a 25-second total deadline, minimal thinking and a shorter output prompt. Tomorrow resolves using the Thailand calendar day. Invalid task IDs, cycles and cross-day dependencies are rejected.
- Fallback separates preparation/eating and washing/hanging, reads durations and trailing times, represents reserved breaks, keeps dependencies, and proposes clearly labelled preparation/break times.
- Dependencies survive the review-to-scheduler handoff. Flexible tasks search available gaps instead of being pushed behind evening appointments. Original task titles/descriptions survive model scheduling.
- Shared proposal validation blocks overlapping tasks, invalid dependencies, crossing midnight and violating an explicitly supplied care window. Approval checks this again on the server. Fixed conflicts require review rather than silently moving appointments.
- Editing text invalidates prior extraction; requests cannot double-submit. Empty times remain empty and cannot silently save as 09:00. Multi-day drafts cannot be handed off as one day. Warnings are collapsed and fallback status distinguishes timeout, quota and response-format failures.
- Modal requests ignore stale results and validate edited times before approval. Malformed JSON returns 400 for extraction, scheduling and approval.

## Verification and limits

- Complete reported routine produces 14 fallback tasks, including two caregiver breaks and the reserved 13:00–14:00 block. The deterministic proposal has no overlap, preserves dependencies and stays inside 07:00–18:00.
- Unit tests exercise the full routine, trailing-time parsing, medical classification, invalid IDs/cycles and schedule collisions. Browser regression exercises extraction, schedule-review handoff, stale clearing and mobile width, using deterministic synthetic responses without provider calls or schedule writes.
- Live Gemini tests during investigation returned a timeout, a response-schema failure and subsequently HTTP 429. Live-provider availability is therefore still a limitation; local UI/test success does not establish provider recovery. A native output-schema experiment was removed after HTTP 400.
- No database schema changes, hosted database writes, Git merge or push were performed for this fix. This validation concerns the submitted proposal; it does not guarantee absence of conflicts against independently existing recurring tasks.
