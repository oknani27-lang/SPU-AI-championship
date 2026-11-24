# AI reliability verification — 24 November 2026

## Findings and changes

- Configured keys were labelled as "AI ready" despite upstream errors. The badge now only states that the key is configured.
- Gemini Flash Lite returned repeated HTTP 503 responses in live tests. The local model and example/default model were changed to `gemini-3.5-flash` after successful tests with the same key. No credential values were logged or committed.
- Shared transport retries transient HTTP 5xx once, within a total deadline. It never retries invalid credentials/quota errors, ignores thought parts, and rejects blocked, truncated or invalid JSON output.
- Aftercare formerly required Gemini to retype exact source quotes. It now references server-generated source IDs. The server reconstructs quotes and medication text, validates numeric claims and preserves safe time typography such as `09:30`/`9:30` without allowing changed doses.
- Schedule proposals reject unknown/duplicate task IDs and dependency-order violations. Medical task text, time and duration remain tied to user input.
- Rest suggestions are checked against available gaps, exact durations, mutual overlaps and supervision constraints. Its timeout now permits a 25-second total request budget. The UI distinguishes AI suggestions from rule-based fallback.
- Daily summary/rest routes reject malformed JSON and impossible dates instead of generating for today. Safe failure metadata stays outside stored telemetry.

## Evidence

- 53 automated tests passed; lint and TypeScript checks passed.
- Live local Demo API tests with synthetic data returned actual Gemini results for text-to-task, schedule generation, daily summary and rest suggestions. Rest returned four suggestions with `used_fallback=false`.
- The complete fictional knee-visit note in `scripts/fixtures/doctor-note.txt` passed the real aftercare Browser test: consent, actual Gemini response, source disclosure, review/copy gating, responsive layout and clearing stale results after input edits.
- No hosted database writes, Git merge or push. Existing nonmedical feature fallbacks remain labelled; medical summaries never fabricate a replacement when AI is unavailable.

Provider availability can still vary. A successful check is evidence of that run, not a continuous health guarantee.

## Aftercare latency follow-up

- Aftercare alone requests minimal thinking and a bounded 3072-token response. Medication evidence is reconstructed from original source IDs, avoiding duplicated generated paragraphs while preserving literal medication text.
- Synthetic note timing: about 9 seconds before optimization; 2.6 seconds for the measured direct call afterward. A live browser flow on port 3001 also passed. These are individual observations, not a latency guarantee.
- Re-submitting identical text reuses the last successful summary in component memory after consent checks. Clear and account remount discard it; nothing is written to browser storage. Browser smoke checks assert no extra API request on repeated submission.
