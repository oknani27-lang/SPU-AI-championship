'use strict';
const { createHash } = require('node:crypto');
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const replyId = id => { const h = createHash('md5').update('bizplan-reply:' + id.toLowerCase()).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
function createSupabase({ url = process.env.SUPABASE_URL, publishable = process.env.SUPABASE_PUBLISHABLE_KEY, secret = process.env.SUPABASE_SECRET_KEY, fetchImpl = fetch, secureCookies = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production' } = {}) {
  const refreshes = new Map();
  async function request(route, { method = 'GET', token, body, privileged = false } = {}) {
    if (!url || !publishable || (privileged && !secret)) throw new ApiError(503, 'ยังไม่ได้ตั้งค่า Supabase ให้ครบในเซิร์ฟเวอร์');
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || publishable.startsWith('sb_secret_')) throw new ApiError(503, 'การตั้งค่า Supabase ไม่ถูกต้อง');
    let response;
    const bearer = privileged && secret.startsWith('eyJ') ? secret : token;
    try { response = await fetchImpl(url + route, { method, headers: { apikey: privileged ? secret : publishable, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) }); }
    catch { throw new ApiError(503, 'เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาลองใหม่'); }
    if (!response.ok) {
      if (response.status === 401) throw new ApiError(401, 'กรุณาเข้าสู่ระบบอีกครั้ง');
      if (response.status === 429) throw new ApiError(429, 'ดำเนินการถี่เกินไป กรุณารอสักครู่');
      if (route.includes('/auth/v1/token') || route.includes('/auth/v1/signup')) throw new ApiError(400, 'เข้าสู่ระบบหรือสมัครไม่สำเร็จ ตรวจอีเมล รหัสผ่าน และการยืนยันอีเมล');
      throw new ApiError(503, 'ยังเข้าถึงข้อมูลไม่ได้ กรุณาตรวจ schema และสิทธิ์ Supabase');
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { return null; }
  }
  function cookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
  }
  function setCookies(res, session) {
    const flags = '; Path=/; HttpOnly; SameSite=Strict' + (secureCookies ? '; Secure' : '');
    const values = session ? [`bp_access=${session.access_token}; Max-Age=${Math.min(session.expires_in || 3600, 3600)}`, `bp_refresh=${session.refresh_token}; Max-Age=1209600`] : ['bp_access=; Max-Age=0', 'bp_refresh=; Max-Age=0'];
    res.setHeader('Set-Cookie', values.map(v => v + flags));
  }
  async function authenticate(req, res) {
    const c = cookies(req);
    let token = c.bp_access;
    if (token) { try { const user = await request('/auth/v1/user', { token }); if (uuid(user?.id)) return { user, token }; } catch (e) { if (e.status !== 401) throw e; } }
    if (!c.bp_refresh) throw new ApiError(401, 'กรุณาเข้าสู่ระบบเพื่อใช้งานประวัติแชต');
    let pending = refreshes.get(c.bp_refresh);
    if (!pending) {
      pending = request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: c.bp_refresh } });
      refreshes.set(c.bp_refresh, pending);
      pending.finally(() => refreshes.delete(c.bp_refresh)).catch(() => {});
    }
    let session;
    try { session = await pending; } catch { setCookies(res, null); throw new ApiError(401, 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); }
    const user = await request('/auth/v1/user', { token: session.access_token });
    if (!uuid(user?.id)) throw new ApiError(401, 'Session ไม่ถูกต้อง');
    setCookies(res, session); return { user, token: session.access_token };
  }
  async function owned(auth, id) {
    if (!uuid(id)) throw new ApiError(400, 'รหัสบทสนทนาไม่ถูกต้อง');
    const rows = await request(`/rest/v1/chat_sessions?id=eq.${id}&user_id=eq.${auth.user.id}&select=*`, { token: auth.token });
    if (!rows?.length) throw new ApiError(404, 'ไม่พบบทสนทนานี้');
    return rows[0];
  }
  async function messages(auth, id, limit = 200) {
    await owned(auth, id);
    return (await request(`/rest/v1/chat_messages?session_id=eq.${id}&select=*&order=created_at.desc,id.desc&limit=${limit}`, { token: auth.token })).reverse();
  }
  async function handle(req, res, body, send) {
    const route = req.url.split('?')[0];
    if (route === '/api/auth/session' && req.method === 'GET') {
      try { const auth = await authenticate(req, res); send(200, { user: { id: auth.user.id, email: auth.user.email } }); } catch (e) { if (e.status !== 401) throw e; send(200, { user: null }); } return true;
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
      const token = cookies(req).bp_access;
      setCookies(res, null);
      if (token) { try { await request('/auth/v1/logout', { method: 'POST', token }); } catch {} }
      send(200, { ok: true }); return true;
    }
    if (['/api/auth/login', '/api/auth/register'].includes(route) && req.method === 'POST') {
      if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw new ApiError(400, 'กรอกอีเมลให้ถูกต้อง และรหัสผ่าน 8–128 ตัวอักษร');
      const data = await request(route.endsWith('login') ? '/auth/v1/token?grant_type=password' : '/auth/v1/signup' + (req.bizplanOrigin ? '?redirect_to=' + encodeURIComponent(req.bizplanOrigin + '/#/login') : ''), { method: 'POST', body: { email: body.email.trim(), password: body.password } });
      if (data?.access_token && data?.refresh_token) setCookies(res, data);
      send(200, { ok: true, confirmationRequired: !data?.access_token }); return true;
    }
    if (!route.startsWith('/api/chat-sessions')) return false;
    const auth = await authenticate(req, res);
    const match = route.match(/^\/api\/chat-sessions\/([a-fA-F0-9-]+)(\/messages)?$/);
    if (route === '/api/chat-sessions') {
      if (req.method === 'GET') send(200, { sessions: await request(`/rest/v1/chat_sessions?user_id=eq.${auth.user.id}&select=*&order=updated_at.desc&limit=100`, { token: auth.token }) });
      else if (req.method === 'POST') {
        const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 100) : 'บทสนทนาใหม่';
        const rows = await request('/rest/v1/chat_sessions', { method: 'POST', token: auth.token, body: { user_id: auth.user.id, title: title || 'บทสนทนาใหม่' } }); send(201, { session: rows[0] });
      } else throw new ApiError(405, 'ไม่รองรับคำขอนี้');
    } else if (match && req.method === 'GET' && match[2]) send(200, { messages: await messages(auth, match[1]) });
    else if (match && req.method === 'DELETE' && !match[2]) { await owned(auth, match[1]); await request(`/rest/v1/chat_sessions?id=eq.${match[1]}&user_id=eq.${auth.user.id}`, { token: auth.token, method: 'DELETE' }); send(200, { ok: true }); }
    else throw new ApiError(404, 'ไม่พบหน้าที่ต้องการ');
    return true;
  }
  async function startTurn(auth, body) {
    if (!secret) throw new ApiError(503, 'ต้องตั้งค่าคีย์ Supabase ฝั่งเซิร์ฟเวอร์ก่อนบันทึกคำตอบ AI');
    if (!uuid(body?.messageId) || typeof body?.content !== 'string' || !body.content.trim() || body.content.length > 2000) throw new ApiError(400, 'ข้อความไม่ถูกต้องหรือยาวเกินกำหนด');
    await owned(auth, body.sessionId);
    const existing = await request(`/rest/v1/chat_messages?id=eq.${body.messageId}&session_id=eq.${body.sessionId}&select=*`, { token: auth.token });
    if (existing.length && (existing[0].role !== 'user' || existing[0].content !== body.content.trim())) throw new ApiError(409, 'ข้อความขัดแย้ง กรุณาเปิดบทสนทนาใหม่');
    if (!existing.length) await request('/rest/v1/chat_messages', { method: 'POST', token: auth.token, body: { id: body.messageId, session_id: body.sessionId, role: 'user', content: body.content.trim() } });
    const replies = await request(`/rest/v1/chat_messages?id=eq.${replyId(body.messageId)}&session_id=eq.${body.sessionId}&role=eq.assistant&select=*`, { token: auth.token });
    if (replies.length) return { cached: replies[0].content };
    const rows = await messages(auth, body.sessionId, 20);
    const pairs = [];
    for (let i = 0; i < rows.length - 1; i++) if (rows[i].role === 'user' && rows[i + 1].role === 'assistant' && rows[i].id !== body.messageId) { pairs.push({ role: 'user', content: rows[i].content }, { role: 'assistant', content: rows[i + 1].content }); i++; }
    const context = [...pairs.slice(-8), { role: 'user', content: body.content.trim() }];
    while (context.reduce((n, m) => n + m.content.length, 0) > 8000 && context.length > 1) context.splice(0, 2);
    return { messages: context };
  }
  async function finishTurn(auth, body, reply) {
    await owned(auth, body.sessionId);
    const data = await request('/rest/v1/rpc/bizplan_complete_turn', { method: 'POST', privileged: true, body: { p_user_id: auth.user.id, p_session_id: body.sessionId, p_message_id: body.messageId, p_content: reply } });
    return Array.isArray(data) ? data[0]?.content : data?.content;
  }
  return { handle, authenticate, startTurn, finishTurn };
}
module.exports = { createSupabase, ApiError, replyId };
