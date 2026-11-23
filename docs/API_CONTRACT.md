# CarePlan API Contract (Shared Between Backend Subagent 1 & Frontend Subagent 2)

All API routes are same-origin Next.js App Router Route Handlers (`/api/*`).
All Supabase keys and `GEMINI_API_KEY` stay strictly on the server.
Default timezone: `Asia/Bangkok` (UTC+7).

## Auth & Session
- `GET /api/auth/session` -> `SessionState`
- `POST /api/auth/register` -> body `{ email, password, full_name, care_recipient_name?, care_recipient_age? }` -> `{ user, mode, requires_email_confirmation? }`
- `POST /api/auth/login` -> body `{ email, password }` -> `{ user, mode }`
- `POST /api/auth/demo` -> starts clearly labeled Hackathon Demo Mode session (seeded persistent server-side store, supports `?reset=1` or body `{ reset?: boolean }`) -> `{ user, mode: "demo" }`
- `POST /api/auth/logout` -> `{ ok: true }`

## Weekly Schedule & Templates
- `GET /api/schedule` -> `{ weekly_schedule, templates: RecurringTaskTemplate[], dependencies: TaskDependency[] }`
- `PATCH /api/schedule/rest-day` -> body `{ day_of_week: 1..7, is_rest_day: boolean }` -> `{ weekly_schedule, medical_disclaimer: string }`
- `POST /api/schedule/approve` -> body `{ day_of_week: 1..7, effective_from_date?: "YYYY-MM-DD", tasks: ProposedScheduleTask[] }` -> `{ templates, occurrences }` (saves user-approved AI/manual tasks for that weekday and generates active occurrences)
- `PATCH /api/templates/[id]` -> body `{ title?, description?, scheduled_time?, duration_minutes?, priority?, is_fixed_time?, is_medically_prescribed?, effective_from_date? }`
  - **STRICT RULE (Feature 6):** Rejects with `409 Conflict` if an active incomplete occurrence for today/current week exists! Allowed ONLY after current occurrence is completed (creates future version starting next week / `effective_from_date`, leaving past history immutable!).

## Daily Occurrences, Photo Proof & Immutable Completion
- `GET /api/occurrences?date=YYYY-MM-DD` (or `?weekStart=YYYY-MM-DD`) -> `{ date, day_of_week, is_rest_day, occurrences: DailyTaskOccurrence[], next_task: DailyTaskOccurrence | null }`
  - Automatically materializes recurring templates for the requested date/week (including next week!) into `daily_task_occurrences` if not yet generated and not a rest day.
- `GET /api/occurrences/[id]` -> `{ occurrence: DailyTaskOccurrence, history: TaskHistoryEntry[], next_dependent: DailyTaskOccurrence | null }`
- `PATCH /api/occurrences/[id]` -> **ALWAYS REJECTED (`403` / `409`)** for active incomplete tasks ("Active incomplete tasks cannot be edited") and completed tasks ("Completed tasks are immutable").
- `DELETE /api/occurrences/[id]` -> **ALWAYS REJECTED (`403` / `409`)** for active incomplete and completed tasks.
- `POST /api/occurrences/[id]/evidence` -> `multipart/form-data` with `file` (valid image: jpeg/png/webp/heic, max 5MB) -> uploads to private storage (Supabase Storage private bucket or demo private disk store) -> `{ evidence: CompletionEvidence }`
- `GET /api/evidence/[id]` -> streams/serves private photo ONLY to authenticated owner (401/403 cross-user protection!).
- `POST /api/occurrences/[id]/confirm` -> body `{}` -> Backend atomically verifies at least one uploaded photo evidence exists (`400` if missing!), marks occurrence `completed`, sets `completed_at`, `is_delayed`, `is_locked = true`, locks evidence, logs `completed_confirmed`, and notifies next dependent task if applicable -> `{ occurrence, next_dependent, notifications_created }`

## History (Read-Only)
- `GET /api/history?limit=50` -> `{ completed_occurrences: DailyTaskOccurrence[], history_events: TaskHistoryEntry[] }`

## AI Features (Server-Only Gemini + Zod + Honest Fallback)
- `POST /api/ai/text-to-task` -> body `{ text: string, default_day_of_week?: 1..7 }` -> `TextToTaskResponse` (typed text only; no voice!)
- `POST /api/ai/schedule` -> body `{ day_of_week: 1..7, tasks: DraftTaskInput[] }` -> `AiScheduleProposalResponse` (AI Process 1)
- `POST /api/ai/daily-summary` -> body `{ date?: "YYYY-MM-DD" }` -> `{ summary: DailySummaryRecord }` (AI Process 2 — reads verified DB occurrences only!)
- `GET /api/ai/daily-summary?date=YYYY-MM-DD` -> `{ summary: DailySummaryRecord | null, metrics: DailySummaryMetrics }`
- `POST /api/ai/rest-suggestions` -> body `{ date?: "YYYY-MM-DD" }` -> `{ suggestions: RestSuggestionRecord[] }`
- `GET /api/ai/rest-suggestions?date=YYYY-MM-DD` -> `{ suggestions: RestSuggestionRecord[] }`
- `PATCH /api/ai/rest-suggestions/[id]` -> body `{ status: "accepted" | "dismissed" | "ignored" }` -> `{ suggestion: RestSuggestionRecord }`

## Smart Reminders
- `GET /api/reminders` -> `{ preference: ReminderPreference, notifications: NotificationDeliveryLog[] }`
- `POST /api/reminders/process` -> runs backend reminder engine (for Cron with `CRON_SECRET` OR authenticated user simulation with `{ simulate_now?: ISOString, date?: "YYYY-MM-DD" }`) -> `{ delivered: NotificationDeliveryLog[], skipped_reason?: string }`
- `PATCH /api/reminders/[id]/read` -> marks notification read

## Share Schedule
- `GET /api/share` -> `{ links: ShareLinkRecord[] }`
- `POST /api/share` -> body `{ scope: "day" | "week", target_date: "YYYY-MM-DD", include_private_notes: boolean, expires_in_days?: number | null }` -> `{ link: ShareLinkRecord, share_url: string }`
- `DELETE /api/share/[id]` -> revokes share link (`revoked_at = now()`) -> `{ link: ShareLinkRecord }`
- `GET /api/share/public/[token]` -> public no-login endpoint returning `SharedSchedulePayload` (returns `404` if invalid, `410` if expired or revoked; excludes private notes unless explicitly opted in)

## Settings & Privacy
- `GET /api/settings` -> `{ profile, care_recipient, reminder_preference }`
- `PATCH /api/settings` -> updates profile, care_recipient, and/or reminder_preference (timezone, interval, quiet hours, browser notification state)
- `POST /api/privacy/deletion-request` -> records privacy-compliant personal data deletion request (does NOT act as an ordinary edit to historical evidence!) -> `{ request_id, status: "recorded", message }`
