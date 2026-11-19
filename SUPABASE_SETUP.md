# Supabase setup — owner actions

The Node/vanilla JavaScript stack is preserved. No Next.js environment prefixes or browser SDK are needed: the server uses Supabase Auth and PostgREST over HTTPS, and the browser talks only to same-origin APIs. No Supabase or Gemini key is sent to the browser. Authentication cookies are HttpOnly, SameSite=Strict and scoped to `/`; this application remains loopback-only. Public hosting requires HTTPS/Secure cookies plus the existing deployment safeguards.

## Local environment

The following variables are read only by the server:

```ini
SUPABASE_URL=https://ngkwsavxyyaeygduzvqc.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key_here
SUPABASE_SECRET_KEY=your_server_only_supabase_secret_key_here
```

The supplied publishable key has been saved in the project's private `.env`. Paste the project Secret Key into `.env` locally; never send it in chat. A legacy service_role key is also supported server-side. The secret is used only by the authorized RPC that writes assistant responses; list/read/create/delete operations use the authenticated user's access token and RLS. The Gemini key remains unchanged.

## Database

1. Open your Supabase project → SQL Editor.
2. Inspect existing `public.chat_sessions` / `public.chat_messages` first. The integration check received 404 for both, but no privileged schema inspection was possible. Do not replace existing tables or data.
3. Run `supabase/migrations/20261119_chat.sql` once. It is transactional and fails if table names already exist. It creates only the two requested tables, indexes, RLS policies and a restricted completion RPC. No user data is deleted.
4. Enable email/password authentication. Keep email confirmation enabled as appropriate. Configure Site URL / allowed redirects for your local origin (`http://localhost:3000`). After confirming email, return to the login page and sign in; no tokens from URL fragments are imported into browser storage.
5. Restart `npm start` after changing environment values.

## Behavior and authorization

- `#/login`, `#/register`: email/password registration, login and confirmation/error states. Logout is in the existing navbar.
- Access/refresh tokens stay in HttpOnly cookies. The server validates users with Supabase Auth and refreshes expired sessions; passwords and tokens are never logged. Auth attempts are limited per IP.
- History requires login. Chat has new conversation, previous conversations, load/continue and confirmed delete. Deleting a session cascades its messages. Changing accounts clears client-visible conversation state.
- `GET/POST /api/chat-sessions`, `GET /api/chat-sessions/:id/messages`, `DELETE /api/chat-sessions/:id` enforce authentication and owner filters on every operation, backed by RLS.
- `POST /api/idea-chat` now accepts `{ sessionId, messageId, content }`. The server loads context from the database instead of trusting client-authored assistant history.
- The user message is saved before Gemini. If generation fails it remains recoverable in history; browser input is restored for retry. Reusing the same message ID/content avoids duplicate persisted user messages and reuses an already saved reply. Assistant response and session activity are written by `bizplan_complete_turn`, executable only by `service_role`, with an explicit ownership check inside the function too.
- Users cannot directly insert assistant messages or update/delete individual messages. They can delete their own whole session, and update only the title (not ownership) through the database. RLS blocks reading/writing another user's sessions or messages. These policies must still be tested in the real project.
- The last 100 sessions and latest 200 messages are displayed; older messages remain in the database. Gemini context remains bounded to nine messages / 8,000 characters. Request caps/timeouts remain active. Public/multi-instance deployment is still out of scope.

## Verification status

`npm test` uses a simulated Supabase provider and checks Auth requests, secure cookie attributes, refresh, two simulated user identities, ownership denial, message persistence, server-only assistant writes, retry behavior and static SQL restrictions. These are application tests, not a live RLS audit.

Live check: the configured Supabase Auth settings endpoint returned HTTP 200; both table endpoints returned HTTP 404. The Supabase management connector denied project access. The migration has NOT been applied by Codex, and a server secret has NOT been provided. Consequently live registration/login, two-real-user RLS isolation and persistent end-to-end Gemini chat have NOT been verified yet. Do not treat simulated tests as production security verification.

After configuring the schema and server key, create two test accounts using your own email addresses. Confirm both accounts, then test: A creates/sends/reloads/continues; B sees none of A's history; requests by B for A's session/messages/send/delete must fail; unauthenticated requests must fail; direct assistant inserts and completion RPC calls by an authenticated client must fail. Confirm deletion only removes the selected test session. Keep real users' data intact.
