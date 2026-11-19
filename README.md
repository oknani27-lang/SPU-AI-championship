# Bizplan. — Gemini Idea Discovery

Node.js 22+ (tested with Node 24), no dependencies. UI and hash routing remain unchanged. Only the idea chat uses AI; other features remain placeholders.

## Run

Keep the real `GEMINI_API_KEY` in local `.env` or server environment only. Environment variables already set in the process take precedence. Never commit or serve `.env`.

```powershell
cd C:\Users\oknan\Downloads\SPU-AI-championship
npm start
```

Open `http://localhost:3000/#/idea-chat`. Stop any previous server on port 3000 first, or set `$env:PORT = '3001'`. Do not use `serve .`: it has no API and can expose private files. Opening `index.html` directly shows UI but cannot call AI.

The server binds only to `127.0.0.1`; it serves exactly index.html, app.js and styles.css. It blocks `.env`, server code, tests and runtime files. No public deployment is enabled.

## API and limits

`POST /api/idea-chat` accepts JSON `{ messages: [{ role: 'user' | 'assistant', content: string }] }` and returns `{ reply }` or a safe `{ error }`.

Model: `gemini-3.1-flash-lite` via Google generateContent REST. A server-only system prompt asks about interests, industry, skills, budget and goals one at a time, then explores online-business ideas. It does not promise verified research or revenue. Users should verify AI output.

- Input 2,000 characters; history at most 9 messages / 8,000 characters; output at most 512 tokens and 4,000 display characters.
- Static welcome is excluded from context; old turn pairs are dropped, so earlier details can be forgotten. Authenticated chat now persists in Supabase; the latest 200 messages are loaded when opening a session. See SUPABASE_SETUP.md for the required migration and server key.
- 20-second provider timeout; 25-second browser timeout. No automatic retries/fallback. Failed messages remain visible and draft is restored, but failed turns are excluded from later context.
- One pending request per IP; two globally. Five attempts/minute and 30/day per IP.
- Global cap of 100 attempts per UTC day is reserved before calls in `.runtime/usage.json`, including failed attempts. File errors fail closed; restart preserves the global daily count. Do not delete this file to reset limits.
- These are request/token ceilings, not a precise monetary budget. Configure provider-side project quotas and billing controls too.

Per-IP limits are process-local and reset on restart. Before public or multi-instance hosting, add HTTPS, an approved public origin, trusted proxy configuration and shared persistent limits. Keep usage files on persistent storage. Current Host/Origin checks intentionally reject public access. This is a single-instance local server.

## Routes

`#/` landing; `#/dashboard` empty overview; `#/planner` idea selection; `#/planner?view=form` original form; `#/idea-chat` live idea chat. `#/discovery`, `#/analysis`, `#/tutor`, `#/growth` remain placeholders.

## Validation

`npm test` uses a stub provider without secrets or external requests. `npm run check` checks syntax of app.js and server.cjs. No build or TypeScript compiler is configured. Tests cover navigation, safe rendering, context bounds, duplicate prevention, loading, failure recovery, cancellation, validation, origin checks, secret-file blocking, rate limits, daily caps, provider failures and timeout.

No market-analysis AI, planner AI, customer-finder AI, authentication, database or payment integration is introduced. Google Fonts remains externally hosted with system-font fallback.

## Supabase authentication and history
See SUPABASE_SETUP.md for environment setup, the transactional SQL migration, API changes, ownership enforcement, and the exact live-verification limitations. The earlier memory-only description applies to the pre-Supabase phase; the current chat requires login and a configured database. Use npm start, not a generic static server.
