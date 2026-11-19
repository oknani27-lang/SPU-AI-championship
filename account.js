'use strict';
let accountUser = null;
let accountReady = false;
let accountError = '';
let selectedSession = null;
let savedSessions = [];
let historyBusy = false;
let historyError = '';
let failedTurn = null;
let historyRequest = 0;
async function accountApi(route, method = 'GET', body) {
  const response = await fetch(route, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  let data;
  try { data = await response.json(); } catch { throw new Error('การตอบกลับไม่สมบูรณ์ กรุณาลองใหม่'); }
  if (!response.ok) {
    if (response.status === 401) {
      accountUser = null; savedSessions = []; selectedSession = null; failedTurn = null; historyRequest++; historyBusy = false;
      chatMessages.length = 0; updateAccountNav();
    }
    throw new Error(typeof data.error === 'string' ? data.error : 'เชื่อมต่อระบบไม่สำเร็จ');
  }
  return data;
}
function accountPage(register = false) {
  return `<section class="container app-page"><div class="auth-card"><a class="back-link" href="#/idea-chat">← กลับสู่แชต</a><h1>${register ? 'สร้างบัญชี Bizplan.' : 'เข้าสู่ระบบ Bizplan.'}</h1><p>เก็บบทสนทนาและกลับมาต่อยอดไอเดียของคุณ</p><form id="account-form" data-mode="${register ? 'register' : 'login'}"><label for="account-email">อีเมล</label><input id="account-email" type="email" name="email" autocomplete="email" maxlength="254" required><label for="account-password">รหัสผ่าน</label><input id="account-password" type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" required><button class="button" type="submit">${register ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</button><p id="account-status" role="status">${escapeHtml(accountError)}</p></form><a href="#/${register ? 'login' : 'register'}">${register ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก'}</a></div></section>`;
}
async function refreshAccount() {
  const previousUser = accountUser?.id;
  try { accountUser = (await accountApi('/api/auth/session')).user; accountError = ''; }
  catch { accountUser = null; accountError = 'เชื่อมต่อบัญชีไม่ได้ กรุณาตรวจการตั้งค่า Supabase'; }
  if (previousUser !== accountUser?.id) {
    chatMessages.length = 0; selectedSession = null; savedSessions = []; failedTurn = null; historyRequest++; historyBusy = false;
  }
  accountReady = true;
  updateAccountNav();
  if (location.hash.startsWith('#/idea-chat')) { updateChat(); await loadHistory(); }
}
function updateAccountNav() {
  const login = document.querySelector('[data-account]');
  if (login) login.textContent = accountUser ? 'ออกจากระบบ' : 'เข้าสู่ระบบ';
}
function historyMarkup() {
  if (!accountReady) return '<p role="status">กำลังตรวจบัญชี…</p>';
  if (!accountUser) return `<h2>ประวัติแชต</h2><p>เข้าสู่ระบบเพื่อบันทึกและเปิดบทสนทนาเดิม</p><a class="button small" href="#/login">เข้าสู่ระบบ</a><a class="history-register" href="#/register">สมัครสมาชิก</a>${accountError ? `<p role="status">${escapeHtml(accountError)}</p>` : ''}`;
  return `<div class="history-heading"><h2>ประวัติแชต</h2><button data-new-chat ${chatPending ? 'disabled' : ''}>＋ แชตใหม่</button></div>${historyBusy ? '<p role="status">กำลังโหลดประวัติ…</p>' : ''}${historyError ? `<p role="status">${escapeHtml(historyError)}</p><button data-reload-history>ลองใหม่</button>` : ''}${!historyBusy && !savedSessions.length ? '<p>ยังไม่มีบทสนทนา เริ่มแชตแรกของคุณได้เลย</p>' : ''}<ul>${savedSessions.map(s => `<li><button class="history-open ${selectedSession === s.id ? 'selected' : ''}" data-open-chat="${escapeHtml(s.id)}" ${chatPending ? 'disabled' : ''}>${escapeHtml(s.title)}</button><button class="history-delete" data-delete-chat="${escapeHtml(s.id)}" aria-label="ลบบทสนทนา ${escapeHtml(s.title)}" ${chatPending ? 'disabled' : ''}>×</button></li>`).join('')}</ul>`;
}
function updateHistory() {
  const el = document.getElementById('chat-history');
  if (el && location.hash.startsWith('#/idea-chat')) el.innerHTML = historyMarkup();
}
async function loadHistory() {
  if (!accountUser) { updateHistory(); return; }
  const owner = accountUser.id;
  historyBusy = true; historyError = ''; updateHistory();
  try { const data = await accountApi('/api/chat-sessions'); if (accountUser?.id === owner) savedSessions = data.sessions; }
  catch (e) { if (accountUser?.id === owner) historyError = e.message; }
  finally { if (accountUser?.id === owner) { historyBusy = false; updateHistory(); updateChat(); } }
}
function newChat() {
  if (chatPending) return;
  historyRequest++; selectedSession = null; failedTurn = null;
  historyBusy = false;
  chatMessages.length = 0;
  chatStatus = 'เริ่มบทสนทนาใหม่ ข้อความจะบันทึกในบัญชีของคุณ';
  document.getElementById('chat-input').value = '';
  updateChat(); updateHistory();
}
async function openChat(id) {
  if (chatPending) return;
  const draft = document.getElementById('chat-input').value;
  if (draft.trim() && !window.confirm('มีข้อความที่ยังไม่ได้ส่ง ต้องการเปลี่ยนบทสนทนาหรือไม่?')) return;
  const request = ++historyRequest;
  historyBusy = true; historyError = ''; updateHistory();
  try {
    const data = await accountApi(`/api/chat-sessions/${id}/messages`);
    if (request !== historyRequest) return;
    selectedSession = id; failedTurn = null; chatMessages.length = 0;
    chatMessages.push(...data.messages.map(m => ({ id: m.id, role: m.role, content: m.content })));
    document.getElementById('chat-input').value = '';
    chatStatus = 'โหลดบทสนทนาแล้ว · คำตอบ AI อาจคลาดเคลื่อน'; updateChat();
  } catch (e) { historyError = e.message; }
  finally { if (request === historyRequest) { historyBusy = false; updateHistory(); updateChat(); } }
}
async function deleteChat(id) {
  if (chatPending || !window.confirm('ลบบทสนทนานี้และข้อความทั้งหมด? การลบไม่สามารถย้อนกลับได้')) return;
  try { await accountApi(`/api/chat-sessions/${id}`, 'DELETE'); if (selectedSession === id) newChat(); await loadHistory(); }
  catch (e) { historyError = e.message; updateHistory(); }
}
async function submitAccount(form) {
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  const status = document.getElementById('account-status'); status.textContent = 'กำลังดำเนินการ…';
  try {
    const data = await accountApi(`/api/auth/${form.dataset.mode}`, 'POST', { email: form.elements.email.value, password: form.elements.password.value });
    form.elements.password.value = '';
    if (data.confirmationRequired) { status.textContent = 'ตรวจอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ'; return; }
    await refreshAccount();
    if (accountUser) location.hash = '#/idea-chat';
    else status.textContent = 'กรุณายืนยันอีเมลแล้วลองเข้าสู่ระบบอีกครั้ง';
  } catch (e) { status.textContent = e.message; }
  finally { button.disabled = false; }
}
async function logoutAccount() {
  if (chatPending) return;
  try { await accountApi('/api/auth/logout', 'POST', {}); }
  catch { accountError = 'ออกจากระบบไม่สำเร็จ กรุณาลองใหม่'; updateHistory(); return; }
  accountUser = null; savedSessions = []; selectedSession = null; failedTurn = null; historyRequest++; historyBusy = false; historyError = '';
  chatMessages.length = 0; updateAccountNav();
  location.hash = '#/login'; render();
}
document.addEventListener('click', event => {
  if (event.target.closest('[data-account]')) { accountUser ? logoutAccount() : location.hash = '#/login'; return; }
  if (event.target.closest('[data-new-chat]')) { newChat(); return; }
  const open = event.target.closest('[data-open-chat]');
  if (open) { openChat(open.dataset.openChat); return; }
  const remove = event.target.closest('[data-delete-chat]');
  if (remove) { deleteChat(remove.dataset.deleteChat); return; }
  if (event.target.closest('[data-reload-history]')) loadHistory();
});
document.addEventListener('submit', event => { if (event.target.id === 'account-form') { event.preventDefault(); submitAccount(event.target); } });
