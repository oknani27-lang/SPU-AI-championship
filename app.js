'use strict';

// Email confirmation may return tokens in the fragment; this app uses server cookies and manual login.
if (/(?:^#|[&#])(?:access_token|refresh_token|error_description)=/.test(location.hash)) {
  accountError = /(?:^#|[&#])error=/.test(location.hash) ? 'ลิงก์ยืนยันอีเมลไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่' : 'ยืนยันอีเมลแล้ว กรุณาเข้าสู่ระบบ';
  history.replaceState(null, '', location.pathname + location.search + '#/login');
}

// Change the product name here and in the static document title/navigation.
const BRAND = 'Bizplan.';
const features = [
  { id: 'discovery', icon: 'bulb', title: 'AI Business Discovery', thai: 'ค้นหาไอเดียธุรกิจ', description: 'ช่วยสำรวจว่าผู้ใช้มีธุรกิจแล้วหรือยัง และช่วยสร้างหรือพัฒนาไอเดียตามเป้าหมาย งบประมาณ และทักษะ', color: 'blue', fields: ['ไอเดียหรือธุรกิจที่สนใจ', 'ทักษะและประสบการณ์ของคุณ', 'งบประมาณเบื้องต้น'] },
  { id: 'analysis', icon: 'chart', title: 'AI Business & Competitor Analysis', thai: 'วิเคราะห์ตลาดและคู่แข่ง', description: 'วิเคราะห์ธุรกิจ ตลาด คู่แข่ง จุดแข็ง จุดอ่อน และความเสี่ยงอย่างเป็นกลาง', color: 'purple', fields: ['ธุรกิจที่ต้องการศึกษา', 'กลุ่มลูกค้าเป้าหมาย', 'คู่แข่งที่คุณรู้จัก'] },
  { id: 'tutor', icon: 'cap', title: 'AI Business Tutor', thai: 'เรียนรู้สิ่งที่จำเป็น', description: 'ให้ความรู้เรื่องการเงิน การตลาด กฎหมาย และการบริหารก่อนลงมือจริง', color: 'blue', fields: ['หัวข้อที่อยากเรียนรู้', 'ประสบการณ์ในการทำธุรกิจ', 'เป้าหมายการเรียนรู้'] },
  { id: 'planner', icon: 'clipboard', title: 'AI Business & Team Planner', thai: 'วางแผนธุรกิจและทีมงาน', description: 'วางแผนธุรกิจ โมเดลรายได้ งบประมาณ แผนงาน และโครงสร้างทีมพร้อมทักษะที่ต้องมี', color: 'orange', fields: ['ชื่อแผนธุรกิจ', 'เป้าหมายของธุรกิจ', 'ทีมงานและทรัพยากรที่มี'] },
  { id: 'growth', icon: 'target', title: 'AI Customer Finder & Growth', thai: 'หาลูกค้าและต่อยอดการเติบโต', description: 'ช่วยหากลุ่มลูกค้าเป้าหมาย วางแนวทางขาย ติดตามผล และขยายธุรกิจ', color: 'green', fields: ['สินค้าหรือบริการของคุณ', 'ลูกค้าที่ต้องการเข้าถึง', 'ช่องทางขายที่สนใจ'] }
];
/** @typedef {{name: string, updated: string, progress: number | null}} BusinessPlan */
/** @typedef {{plans: BusinessPlan[], planCount: number | null, projectCount: number | null, growth: string | null, daysToGoal: number | null}} DashboardData */
/** @type {DashboardData} No service is connected; null means unavailable, not zero. */
const dashboardData = { plans: [], planCount: null, projectCount: null, growth: null, daysToGoal: null };
const emptyResults = {
  discovery: ['ยังไม่มีไอเดียธุรกิจ', 'เริ่มต้นด้วยการสร้างข้อมูลธุรกิจ'],
  analysis: ['ยังไม่มีผลการวิเคราะห์', 'เริ่มต้นด้วยการสร้างข้อมูลธุรกิจ'],
  tutor: ['ยังไม่มีเนื้อหาการเรียนรู้', 'เลือกหัวข้อที่คุณต้องการเรียนรู้'],
  planner: ['ยังไม่มีแผนธุรกิจ', 'สร้างแผนแรกเพื่อเริ่มต้น'],
  growth: ['ยังไม่มีข้อมูลลูกค้า', 'เริ่มต้นด้วยการสร้างข้อมูลธุรกิจ']
};
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
/** @param {{status: 'empty' | 'loading' | 'success' | 'error', title: string, message: string}} state */
function resultState(state, symbol = 'file') {
  return `<div class="empty-state" role="status" aria-live="polite" aria-busy="${state.status === 'loading'}">${icon(symbol)}<h3>${escapeHtml(state.title)}</h3><p>${escapeHtml(state.message)}</p>${state.status === 'loading' ? '<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>' : ''}</div>`;
}
/** @param {BusinessPlan[]} plans */
function planList(plans) {
  if (!plans.length) return resultState({ status: 'empty', title: 'ยังไม่มีแผนธุรกิจ', message: 'เริ่มสร้างแผนธุรกิจแรกของคุณ' }) + button('สร้างแผนแรกเพื่อเริ่มต้น', '#/planner');
  return plans.map(plan => `<a class="plan-row" href="#/planner">${icon('file')}<div class="plan-name"><strong>${escapeHtml(plan.name)}</strong><span>${escapeHtml(plan.updated)}</span></div>${plan.progress == null ? '<span>—</span><span>—</span>' : `<progress max="100" value="${Math.min(100, Math.max(0, plan.progress))}" aria-label="ความคืบหน้า ${escapeHtml(plan.name)}">${Math.min(100, Math.max(0, plan.progress))}%</progress><strong class="percent">${Math.min(100, Math.max(0, plan.progress))}%</strong>`}${icon('chevron')}</a>`).join('');
}
const paths = {
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 12h8M8 16h8"/>',
  chart: '<path d="M4 20v-6M9 20V9M14 20V5M19 20V2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v2"/>',
  target: '<circle cx="11" cy="13" r="9"/><circle cx="11" cy="13" r="5"/><path d="m11 13 9-10M16 3h4v4"/>',
  folder: '<path d="M3 5h6l2 3h10v13H3Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
  bulb: '<path d="M8 16c0-3-4-3-4-8a8 8 0 0 1 16 0c0 5-4 5-4 8M8 16h8M9 20h6M10 23h4"/>',
  cap: '<path d="m1 8 11-5 11 5-11 5ZM5 10v7c4 4 10 4 14 0v-7M23 8v9"/>',
  clipboard: '<rect x="4" y="4" width="16" height="19" rx="2"/><rect x="9" y="1" width="6" height="6" rx="2"/><path d="m8 14 3 3 6-7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`; }
function button(label, href, secondary = false) { return `<a class="button${secondary ? ' secondary' : ''}" href="${href}">${label}${icon('arrow')}</a>`; }
function sidebar(active) {
  return `<aside class="sidebar"><a class="brand" href="#/">bizplan<span>.</span></a><nav aria-label="เมนูพื้นที่ทำงาน">${[
    ['dashboard', 'home', 'หน้าหลัก'], ['planner', 'file', 'แผนธุรกิจ'], ['analysis', 'chart', 'การวิเคราะห์'], ['planner', 'people', 'ทีมงาน'], ['growth', 'target', 'ลูกค้า'], ['tutor', 'folder', 'ทรัพยากร']
  ].map(([id, symbol, label], index) => `<a href="#/${id}" ${active === id && (id !== 'planner' || index === 1) ? 'class="active" aria-current="page"' : ''}>${icon(symbol)}${label}</a>`).join('')}<button data-notice="ยังไม่เปิดใช้งาน · การตั้งค่าจะพร้อมใช้งานในระยะถัดไป">${icon('settings')}ตั้งค่า</button></nav></aside>`;
}
function dashboard(preview = false, data = dashboardData) {
  return `<div class="workspace ${preview ? 'preview' : ''}">${sidebar('dashboard')}<div class="dashboard-content"><div class="dashboard-heading"><h${preview ? '2' : '1'}>สวัสดี,<br>มาดูภาพรวมธุรกิจของคุณกันครับ</h${preview ? '2' : '1'}><a class="button small" href="#/planner">${icon('plus')}สร้างแผนธุรกิจใหม่</a></div><p class="data-status">ยังไม่มีข้อมูลธุรกิจ · ยังไม่เชื่อมต่อบริการ</p><div class="stats">${[
    ['file', data.planCount ?? '—', 'แผนธุรกิจ', 'blue'], ['chart', data.projectCount ?? '—', 'โครงการที่กำลังดำเนินการ', 'purple'], ['target', data.growth ?? '—', 'ประมาณการการเติบโต', 'green'], ['calendar', data.daysToGoal == null ? '—' : data.daysToGoal + ' วัน', 'ถึงเป้าหมายระยะถัดไป', 'orange']
  ].map(([symbol, value, label, color]) => `<div class="stat ${color}">${icon(symbol)}<div><strong>${escapeHtml(value)}</strong><span>${label}</span></div></div>`).join('')}</div><div class="list-heading"><h${preview ? '3' : '2'}>แผนธุรกิจของฉัน</h${preview ? '3' : '2'}><a href="#/planner">ดูทั้งหมด ${icon('arrow')}</a></div><div class="plan-list">${planList(data.plans)}</div></div></div>`;
}
function landing() {
  return `<section class="hero"><div class="container"><h1>เริ่มต้นธุรกิจได้อย่างมั่นใจ ด้วย <span>${BRAND}</span></h1><p class="hero-description">Bizplan ใช้พลัง AI ช่วยเปลี่ยนไอเดียของคุณให้เป็นแผนธุรกิจที่นำไปใช้ได้จริง<br>วิเคราะห์โอกาสทางธุรกิจ และช่วยให้ธุรกิจของคุณเติบโตอย่างยั่งยืน</p><div class="hero-actions">${button('เริ่มวางแผนธุรกิจฟรี', '#/dashboard')}${button('ดูวิธีการใช้งาน', '#/?section=workflow', true)}</div><div class="dashboard-preview">${dashboard(true)}</div></div></section>
  <section id="features" class="features-section"><div class="container"><div class="section-heading"><h2>เครื่องมือครบสำหรับการสร้างและเติบโตของธุรกิจ</h2><p>รวมทุกเครื่องมือสำคัญไว้ในที่เดียว เพื่อให้คุณสร้าง วิเคราะห์ วางแผน และขยายธุรกิจได้อย่างมีประสิทธิภาพ</p></div><div class="feature-grid">${features.map(f => `<a class="feature-card ${f.color}" href="#/${f.id}">${icon(f.icon)}<h3>${f.title}</h3><p>${f.description}</p></a>`).join('')}</div></div></section>
  <section id="workflow" class="workflow container"><h2>เริ่มต้นวางแผนธุรกิจใน 5 ขั้นตอน</h2><ol class="steps">${features.map((f, i) => `<li><a href="#/${f.id}"><span>${i + 1}</span>${f.thai}</a>${i < 4 ? icon('arrow') : ''}</li>`).join('')}</ol></section>
  <section class="why container"><div><h2>ทำไมต้องใช้ <span>${BRAND}</span></h2><ul>${['วางแผนเป็นระบบ ครบทุกมิติของธุรกิจ', 'ใช้ AI ช่วยคิด วิเคราะห์ และสรุปให้ง่ายขึ้น', 'เข้าใจง่าย แม้ไม่มีพื้นฐานธุรกิจมาก่อน', 'ช่วยเห็นโอกาส ความเสี่ยง และแนวทางเติบโต', 'เหมาะทั้งผู้เริ่มต้น เจ้าของกิจการ และทีม Startup'].map(t => `<li><span>${icon('check')}</span>${t}</li>`).join('')}</ul></div><div class="growth-card"><div class="bar-art" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><h3>วางแผนให้ชัดเจน<br>พร้อมเติบโตได้จริง</h3><p>เห็นภาพธุรกิจรอบด้าน ตัดสินใจได้แม่นยำ<br>และเดินหน้าได้อย่างมั่นใจ</p></div></div></section>
  <section class="final-cta container"><h2>เริ่มวางแผนธุรกิจของคุณวันนี้</h2><p>เปลี่ยนไอเดียให้เป็นแผนธุรกิจที่นำไปใช้ได้จริง และก้าวสู่การเติบโตอย่างยั่งยืน</p>${button('เริ่มใช้งานฟรี', '#/dashboard')}</section>`;
}
function featurePage(feature) {
  return `<div class="container app-page"><div class="workspace">${sidebar(feature.id)}<div class="feature-content"><a class="back-link" href="#/dashboard">← กลับสู่ภาพรวมธุรกิจ</a><div class="feature-title ${feature.color}">${icon(feature.icon)}<div><p>${feature.title}</p><h1>${feature.thai}</h1></div></div><p class="feature-intro">${feature.description}</p><div>${feature.id === 'planner' ? '<a class="back-link change-choice" href="#/planner">← เปลี่ยนตัวเลือก</a>' : ''}</div><div class="prototype-banner">Phase 0.5 · ยังไม่เปิดใช้งาน · ยังไม่มีการประมวลผล AI หรือบันทึกข้อมูล</div><div class="feature-columns"><form class="form-card" id="business-form"><h2>เริ่มต้นจากข้อมูลของคุณ</h2>${feature.fields.map((label, i) => `<label for="field-${i}">${label}</label>${i === 0 ? `<input id="field-${i}" name="field-${i}" placeholder="ระบุ${feature.fields[0]}" required maxlength="200">` : `<textarea id="field-${i}" name="field-${i}" rows="3" placeholder="ระบุ${label}" maxlength="1000"></textarea>`}`).join('')}<button class="button" type="submit">ยังไม่เปิดใช้งาน ${icon('arrow')}</button><p class="form-note">ข้อมูลอยู่เฉพาะในหน้าจอนี้ และจะหายเมื่อเปลี่ยนหน้า</p></form><section class="result-card" aria-labelledby="result-title"><h2 id="result-title">พื้นที่แสดงผล</h2><div id="feature-result">${resultState({ status: 'empty', title: emptyResults[feature.id][0], message: emptyResults[feature.id][1] }, feature.icon)}${feature.id === 'planner' ? resultState({ status: 'empty', title: 'ยังไม่มีข้อมูลทีมงาน', message: 'ข้อมูลทีมงานจะแสดงที่นี่เมื่อเปิดใช้งานบริการ' }, 'people') : ''}</div></section></div></div></div></div>`;
}
function plannerSelection() {
  return `<section class="container app-page"><div class="workspace">${sidebar('planner')}<div class="feature-content"><a class="back-link" href="#/dashboard">← กลับสู่ภาพรวมธุรกิจ</a><div class="feature-title orange">${icon('clipboard')}<div><p>AI Business & Team Planner</p><h1>คุณมีไอเดียธุรกิจแล้วหรือยัง?</h1></div></div><p class="feature-intro">ไม่ว่าคุณจะมีไอเดียแล้วหรือยังไม่รู้จะเริ่มตรงไหน เราจะช่วยคุณเริ่มต้นทีละขั้นตอน</p><div class="idea-options"><article class="idea-option blue">${icon('bulb')}<h2>ยังไม่มีไอเดียธุรกิจ</h2><p>ยังไม่รู้ว่าจะทำธุรกิจอะไรดี? ลองพูดคุยเพื่อค้นหาความสนใจ ความถนัด และธุรกิจที่อาจเหมาะกับคุณ</p>${button('คุยเพื่อหาไอเดีย', '#/idea-chat')}</article><article class="idea-option orange">${icon('clipboard')}<h2>มีไอเดียแล้ว</h2><p>มีธุรกิจที่อยากทำอยู่แล้ว? เริ่มกรอกข้อมูลเพื่อเตรียมวิเคราะห์และวางแผนธุรกิจได้เลย</p>${button('เริ่มกรอกข้อมูล', '#/planner?view=form', true)}</article></div></div></div></section>`;
}
/** @type {{role: 'user' | 'assistant', content: string, failed?: boolean}[]} Session memory only. */
const chatMessages = [];
let chatPending = false;
let chatStatus = 'ข้อความจะส่งให้ Gemini และบันทึกในบัญชีของคุณ';
let chatController;
let chatRequestId = 0;
const chatSuggestions = ['อาหารและเครื่องดื่ม', 'เทคโนโลยี', 'การศึกษา', 'สุขภาพและความงาม', 'แฟชั่น', 'ธุรกิจบริการ', 'ยังไม่แน่ใจ'];
const chatWelcome = 'สวัสดีครับ 👋\nยังไม่มีไอเดียธุรกิจก็ไม่เป็นไรครับ\n\nเริ่มจากเรื่องง่ายๆ ก่อน\nคุณสนใจเรื่องอะไรเป็นพิเศษ หรือมีอุตสาหกรรมที่อยากลองทำธุรกิจไหม?';
function chatPage() {
  return `<section class="container app-page"><div class="workspace">${sidebar('planner')}<div class="chat-shell"><aside class="chat-history" id="chat-history">${historyMarkup()}</aside><div class="chat-content"><header class="chat-header"><div class="chat-toolbar"><a class="back-link" href="#/planner">← กลับไปเลือกเส้นทางเริ่มต้น</a><button class="clear-chat" data-clear-chat>แชตใหม่</button></div><h1>มาค้นหาไอเดียธุรกิจที่เหมาะกับคุณกัน</h1><p>เริ่มจากสิ่งที่คุณสนใจ แล้วค่อยๆ ค้นหาแนวทางธุรกิจไปด้วยกัน</p><span class="chat-badge">Gemini · ผู้ช่วยค้นหาไอเดียธุรกิจออนไลน์</span></header><div class="conversation" id="conversation" role="log" aria-label="บทสนทนาค้นหาไอเดียธุรกิจ" aria-live="polite" aria-relevant="additions text"></div><div class="suggestions" aria-label="เลือกเรื่องที่คุณสนใจ">${chatSuggestions.map(text => `<button class="suggestion-chip" data-chat-prompt="${text}">${text}</button>`).join('')}</div><form id="chat-form" class="chat-composer"><label class="composer-label" for="chat-input">บอกเราเกี่ยวกับสิ่งที่คุณสนใจ</label><div class="composer-row"><textarea id="chat-input" name="message" rows="2" maxlength="2000" placeholder="พิมพ์ความสนใจของคุณได้เลย…" aria-describedby="chat-help chat-status"></textarea><button id="chat-send" class="button" type="submit" aria-label="ส่งข้อความ">ส่ง ${icon('arrow')}</button></div><div class="composer-footer"><span id="chat-help">Enter เพื่อส่ง · Shift+Enter เพื่อขึ้นบรรทัดใหม่ · ไม่เกิน 2,000 ตัวอักษร</span><p id="chat-status" role="status">ข้อความอยู่ชั่วคราวในหน้านี้และจะหายเมื่อรีเฟรช</p></div></form></div></div></div></section>`;
}
function updateChat() {
  if (!location.hash.startsWith('#/idea-chat')) return;
  const conversation = document.getElementById('conversation');
  conversation.innerHTML = `<div class="message assistant-message"><span class="message-author">Bizplan.</span><p>${escapeHtml(chatWelcome)}</p></div>${chatMessages.map(message => `<div class="message ${message.role === 'assistant' ? 'assistant-message' : 'user-message'}${message.failed ? ' failed-message' : ''}"><span class="message-author">${message.role === 'assistant' ? 'Bizplan. · Gemini' : 'คุณ'}${message.failed ? ' · ส่งไม่สำเร็จ' : ''}</span><p>${escapeHtml(message.content)}</p></div>`).join('')}${chatPending ? '<p class="chat-loading" role="status">กำลังคิดคำตอบ…</p>' : ''}`;
  conversation.scrollTop = conversation.scrollHeight;
  document.getElementById('chat-status').textContent = chatStatus;
  document.getElementById('chat-send').disabled = chatPending || !accountUser || !accountReady || historyBusy;
  document.getElementById('chat-form').setAttribute('aria-busy', String(chatPending));
}
async function sendChat() {
  if (chatPending || historyBusy) return;
  if (!accountUser) { location.hash = '#/login'; return; }
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content) return;
  if (content.length > 2000) {
    document.getElementById('chat-status').textContent = 'กรุณาพิมพ์ไม่เกิน 2,000 ตัวอักษร';
    return;
  }
  if (location.protocol === 'file:') {
    document.getElementById('chat-status').textContent = 'กรุณาเปิดเว็บผ่านเซิร์ฟเวอร์ด้วย npm start เพื่อใช้ AI';
    return;
  }
  const message = { role: 'user', content };
  const messageId = failedTurn?.content === content && failedTurn?.sessionId === selectedSession ? failedTurn.id : crypto.randomUUID();
  chatMessages.push(message);
  if (chatMessages.length > 60) chatMessages.splice(0, chatMessages.length - 60);
  input.value = '';
  chatPending = true;
  chatStatus = 'กำลังรอคำตอบจาก Gemini…';
  chatController = new AbortController();
  const requestId = ++chatRequestId;
  const timer = setTimeout(() => chatController?.abort(), 55000);
  updateChat();
  try {
    if (!selectedSession) {
      const created = await accountApi('/api/chat-sessions', 'POST', { title: content.slice(0, 80) });
      selectedSession = created.session.id;
    }
    const response = await fetch('/api/idea-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: selectedSession, messageId, content }), signal: chatController.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0, 200) : 'ส่งข้อความไม่สำเร็จ กรุณาลองภายหลัง');
    if (typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 4000) throw new Error('คำตอบจากบริการ AI ไม่สมบูรณ์ กรุณาลองใหม่');
    if (requestId !== chatRequestId) return;
    failedTurn = null;
    chatMessages.push({ role: 'assistant', content: data.reply });
    loadHistory();
    chatStatus = 'คำตอบจาก AI อาจคลาดเคลื่อน โปรดตรวจสอบก่อนนำไปใช้ · บันทึกประวัติแล้ว';
  } catch (error) {
    if (requestId !== chatRequestId) return;
    message.failed = true;
    failedTurn = { id: messageId, content, sessionId: selectedSession };
    chatStatus = error.name === 'AbortError' ? 'หมดเวลารอคำตอบ กรุณาลองภายหลัง' : error instanceof TypeError || error instanceof SyntaxError ? 'เชื่อมต่อ AI ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่' : error.message;
    if (location.hash.startsWith('#/idea-chat') && !document.getElementById('chat-input').value) document.getElementById('chat-input').value = content;
  } finally {
    clearTimeout(timer);
    if (requestId === chatRequestId) {
      chatPending = false;
      updateChat();
      if (location.hash.startsWith('#/idea-chat')) document.getElementById('chat-input').focus();
    }
  }
}

function render() {
  const [route, query = ''] = (location.hash.slice(1) || '/').split('?');
  const id = route.replace(/^\//, '');
  const feature = features.find(f => f.id === id);
  const showPlannerForm = new URLSearchParams(query).get('view') === 'form';
  const main = document.getElementById('main');
  main.innerHTML = route === '/' ? landing() : id === 'dashboard' ? `<section class="container app-page"><div class="page-heading"><p>พื้นที่ทำงานของคุณ</p><h1>ภาพรวมธุรกิจ</h1></div>${dashboard()}</section>` : id === 'login' || id === 'register' ? accountPage(id === 'register') : id === 'idea-chat' ? chatPage() : id === 'planner' && !showPlannerForm ? plannerSelection() : feature ? featurePage(feature) : `<section class="container not-found"><h1>ไม่พบหน้าที่ต้องการ</h1>${button('กลับหน้าหลัก', '#/')}</section>`;
  if (id === 'idea-chat') { updateChat(); loadHistory(); }
  updateAccountNav();
  document.title = `${id === 'idea-chat' ? 'ค้นหาไอเดียธุรกิจ' : feature ? feature.thai : id === 'dashboard' ? 'ภาพรวมธุรกิจ' : 'เริ่มต้นธุรกิจอย่างมั่นใจ'} | ${BRAND}`;
  const section = new URLSearchParams(query).get('section');
  if (section === 'features' || section === 'workflow') document.getElementById(section)?.scrollIntoView();
  else window.scrollTo(0, 0);
}
document.addEventListener('click', event => {
  const chip = event.target.closest('[data-chat-prompt]');
  if (chip) {
    document.getElementById('chat-input').value = chip.dataset.chatPrompt;
    document.getElementById('chat-input').focus();
    return;
  }
  if (event.target.closest('[data-clear-chat]')) {
    newChat();
    return;
  }
  const trigger = event.target.closest('[data-notice]');
  if (!trigger) return;
  document.getElementById('notice-message').textContent = trigger.dataset.notice;
  document.getElementById('notice').showModal();
});
document.addEventListener('submit', event => {
  if (event.target.id === 'chat-form') { event.preventDefault(); sendChat(); return; }
  if (event.target.id !== 'business-form') return;
  event.preventDefault();
  document.getElementById('notice-message').textContent = 'ยังไม่เปิดใช้งาน · ยังไม่มีการส่ง บันทึก หรือประมวลผลข้อมูลของคุณ';
  document.getElementById('notice').showModal();
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    sendChat();
  }
});
window.addEventListener('hashchange', () => { render(); document.getElementById('main').focus({ preventScroll: true }); });
render();

if (location.protocol !== 'file:') refreshAccount();
