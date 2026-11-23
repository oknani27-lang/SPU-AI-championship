// These tests exercise application authorization with a simulated provider, not live Supabase RLS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupabase, replyId } = require('../supabase.cjs');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const calls = [], sessions = [{ id: SESSION, user_id: A, title: 'ของ A' }], messages = [];
  const provider = async (raw, init) => {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    const userId = init.headers.Authorization === 'Bearer token-a' ? A : init.headers.Authorization === 'Bearer token-b' ? B : null;
    const json = data => ({ ok: true, status: 200, json: async () => data });
    if (url.pathname === '/auth/v1/user') return userId ? json({ id: userId, email: userId === A ? 'a@example.invalid' : 'b@example.invalid' }) : { ok: false, status: 401 };
    if (url.pathname === '/auth/v1/token') return json({ access_token: 'token-a', refresh_token: 'refresh-new', expires_in: 3600 });
    if (url.pathname === '/auth/v1/signup') return json({ user: { id: A } });
    if (url.pathname === '/auth/v1/logout') return { ok: true, status: 204 };
    if (url.pathname === '/rest/v1/rpc/bizplan_complete_turn') {
      if (init.headers.apikey !== 'sb_secret_test') return { ok: false, status: 403 };
      if (!sessions.some(s => s.id === body.p_session_id && s.user_id === body.p_user_id)) return { ok: false, status: 403 };
      let m = messages.find(m => m.id === replyId(body.p_message_id));
      if (!m) { m = { id: replyId(body.p_message_id), session_id: body.p_session_id, role: 'assistant', content: body.p_content }; messages.push(m); }
      return json(m);
    }
    if (!userId) return { ok: false, status: 401 };
    if (url.pathname === '/rest/v1/chat_sessions') {
      if (init.method === 'POST') { assert.equal(body.user_id, userId); const s = { ...body, id: SESSION }; sessions.push(s); return json([s]); }
      const rows = sessions.filter(s => s.user_id === userId && (!url.searchParams.has('id') || url.searchParams.get('id') === 'eq.' + s.id));
      if (init.method === 'DELETE') { for (const s of rows) sessions.splice(sessions.indexOf(s), 1); }
      return json(rows);
    }
    if (url.pathname === '/rest/v1/chat_messages') {
      if (init.method === 'POST') { assert.equal(body.role, 'user'); messages.push(body); return json([body]); }
      return json(messages.filter(m => sessions.some(s => s.id === m.session_id && s.user_id === userId) && [...url.searchParams].every(([k,v]) => ['select','order','limit'].includes(k) || v === 'eq.' + m[k])).slice().reverse());
    }
    throw new Error('Unexpected provider route');
  };
  const storage = createSupabase({ url: 'https://test.supabase.co', publishable: 'sb_publishable_test', secret: 'sb_secret_test', fetchImpl: provider });
  const auth = user => ({ user: { id: user === 'a' ? A : B }, token: 'token-' + user });
  const res = () => ({ headers: {}, setHeader(k,v) { this.headers[k] = v; } });
  const handle = async (user, url, method = 'GET', body = {}) => {
    let result; const response = res();
    await storage.handle({ url, method, headers: { cookie: user ? 'bp_access=token-' + user : '' } }, response, body, (status,data) => { result = { status, data, headers: response.headers }; });
    return result;
  };
  return { storage, calls, sessions, messages, auth, res, handle };
}
test('login, registration, logout and cookie refresh use Supabase Auth with HttpOnly cookies', async () => {
  const f = fixture();
  const login = await f.handle(null, '/api/auth/login', 'POST', { email: 'a@example.invalid', password: 'test-password-only' });
  assert.equal(login.status, 200);
  assert.ok(login.headers['Set-Cookie'].every(c => c.includes('HttpOnly') && c.includes('SameSite=Strict')));
  assert.equal(JSON.stringify(login.data).includes('token-a'), false);
  const signup = await f.handle(null, '/api/auth/register', 'POST', { email: 'a@example.invalid', password: 'test-password-only' });
  assert.equal(signup.data.confirmationRequired, true);
  const response = f.res();
  const auth = await f.storage.authenticate({ headers: { cookie: 'bp_refresh=refresh-old' } }, response);
  assert.equal(auth.user.id, A);
  assert.ok(response.headers['Set-Cookie']);
  const logout = await f.handle('a', '/api/auth/logout', 'POST');
  assert.ok(logout.headers['Set-Cookie'].every(c => c.includes('Max-Age=0')));
  await assert.rejects(f.handle(null, '/api/auth/login', 'POST', { email: 'bad', password: 'short' }), e => e.status === 400);
});
test('application ownership checks isolate two simulated users on read, send and delete', async () => {
  const f = fixture();
  assert.equal((await f.handle('a', '/api/chat-sessions')).data.sessions.length, 1);
  assert.equal((await f.handle('b', '/api/chat-sessions')).data.sessions.length, 0);
  for (const method of ['GET', 'DELETE']) await assert.rejects(f.handle('b', `/api/chat-sessions/${SESSION}${method === 'GET' ? '/messages' : ''}`, method), e => e.status === 404);
  await assert.rejects(f.storage.startTurn(f.auth('b'), { sessionId: SESSION, messageId: MESSAGE, content: 'forged' }), e => e.status === 404);
  await assert.rejects(f.handle(null, '/api/chat-sessions'), e => e.status === 401);
  assert.equal(f.messages.length, 0);
});
test('user messages persist before AI; assistant uses server-only RPC and retry is idempotent', async () => {
  const f = fixture(), body = { sessionId: SESSION, messageId: MESSAGE, content: 'ธุรกิจออนไลน์' };
  const turn = await f.storage.startTurn(f.auth('a'), body);
  assert.deepEqual(turn.messages, [{ role: 'user', content: body.content }]);
  assert.equal(f.messages[0].role, 'user');
  assert.equal(await f.storage.finishTurn(f.auth('a'), body, 'คุณถนัดอะไร?'), 'คุณถนัดอะไร?');
  const retry = await f.storage.startTurn(f.auth('a'), body);
  assert.equal(retry.cached, 'คุณถนัดอะไร?');
  assert.equal(f.messages.length, 2);
  const rpc = f.calls.find(c => c.url.pathname.includes('/rpc/'));
  assert.equal(rpc.init.headers.apikey, 'sb_secret_test');
  assert.equal(rpc.body.p_user_id, A);
  await assert.rejects(f.storage.finishTurn(f.auth('b'), body, 'forged'), e => e.status === 404);
  const load = await f.handle('a', `/api/chat-sessions/${SESSION}/messages`);
  assert.equal(load.data.messages.length, 2);
});
test('forged IDs and modified retry content are rejected without overwriting records', async () => {
  const f = fixture();
  const body = { sessionId: SESSION, messageId: MESSAGE, content: 'original' };
  await f.storage.startTurn(f.auth('a'), body);
  await assert.rejects(f.storage.startTurn(f.auth('a'), { ...body, content: 'modified' }), e => e.status === 409);
  await assert.rejects(f.storage.startTurn(f.auth('a'), { ...body, messageId: 'bad' }), e => e.status === 400);
  await assert.rejects(f.storage.startTurn(f.auth('a'), { ...body, sessionId: 'id&user_id=eq.other' }), e => e.status === 400);
  assert.equal(f.messages[0].content, 'original');
});
test('missing Supabase configuration fails closed; migration contains explicit RLS and RPC restrictions', async () => {
  const storage = createSupabase({ url: '', publishable: '', secret: '' });
  await assert.rejects(storage.authenticate({ headers: { cookie: 'bp_access=anything' } }, { setHeader() {} }), e => e.status === 503);
  const sql = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261119_chat.sql'),'utf8');
  assert.equal((sql.match(/enable row level security/g)||[]).length, 2);
  assert.match(sql, /role = 'user' and exists/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
});
