const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const accountSource = fs.readFileSync(path.join(__dirname, '..', 'account.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function app(hash = '#/', fetchImpl = async () => ({ ok: true, json: async () => ({ reply: 'คำตอบทดสอบจากบริการ' }) })) {
  const elements = new Map();
  const listeners = {};
  const get = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', setAttribute() {}, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; }, showModal() { this.open = true; } });
    return elements.get(id);
  };
  const routedFetch = (url, init) => url === '/api/idea-chat' ? fetchImpl(url, init) : Promise.resolve({ok:true,json:async()=>({sessions:[],session:{id:'11111111-1111-4111-8111-111111111111'}})});
  const context = vm.createContext({ location: { hash, protocol: 'http:' }, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: routedFetch, crypto: {randomUUID:()=> '22222222-2222-4222-8222-222222222222'}, AbortSignal, document: { querySelector:()=>null, getElementById: get, addEventListener(type, fn) { listeners[type] = fn; } }, window: { confirm:()=>true, scrollTo() {}, addEventListener(type, fn) { listeners[type] = fn; } } });
  vm.runInContext(accountSource, context);
  vm.runInContext("accountUser={id:'owner'};accountReady=true;selectedSession='11111111-1111-4111-8111-111111111111';loadHistory=async()=>{};",context);
  vm.runInContext(source.replace("if (location.protocol !== 'file:') refreshAccount();", ''), context);
  return { get, context, listeners };
}
test('landing includes all sections and five linked feature cards', () => {
  const { get } = app();
  for (const id of ['features', 'workflow']) assert.match(get('main').innerHTML, new RegExp(`id="${id}"`));
  assert.equal((get('main').innerHTML.match(/class="feature-card /g) || []).length, 5);
  assert.match(get('main').innerHTML, /ยังไม่มีแผนธุรกิจ/);
});
test('dashboard and every feature route render without backend calls', () => {
  for (const route of ['dashboard', 'discovery', 'analysis', 'tutor', 'planner?view=form', 'growth']) {
    const { get } = app(`#/${route}`);
    assert.doesNotMatch(get('main').innerHTML, /ไม่พบหน้าที่ต้องการ/);
    assert.match(get('main').innerHTML, route === 'dashboard' ? /ยังไม่มีแผนธุรกิจ/ : /ยังไม่มีการประมวลผล AI/);
    if (route !== 'dashboard') assert.equal((get('main').innerHTML.match(/<label /g) || []).length, 3);
  }
  assert.doesNotMatch(source, /\b(XMLHttpRequest|localStorage)\s*[.(]/);
});
test('unknown routes have a recovery link; section navigation is restricted', () => {
  assert.match(app('#/missing').get('main').innerHTML, /ไม่พบหน้าที่ต้องการ/);
  assert.equal(app('#/?section=workflow').get('workflow').scrolled, true);
});
test('unavailable submission opens notice and preserves the empty result', () => {
  const { listeners, get } = app('#/discovery');
  const before = get('main').innerHTML;
  let prevented = false;
  listeners.submit({ target: { id: 'business-form' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(get('notice-message').textContent, /ยังไม่เปิดใช้งาน/);
  assert.equal(get('notice').open, true);
  assert.equal(get('main').innerHTML, before);
});
test('no fabricated records, dates, statistics or percentages render on any route', () => {
  for (const route of ['/', '/dashboard', '/discovery', '/analysis', '/tutor', '/planner', '/growth']) {
    const html = app(`#${route}`).get('main').innerHTML;
    assert.doesNotMatch(html, /ร้านกาแฟ|คอร์สออนไลน์|อาหารพร้อมทาน|2569|\+28%|56 วัน|\d+%|<progress|class="skeleton"/);
    if (route === '/' || route === '/dashboard') assert.equal((html.match(/<strong>—<\/strong>/g) || []).length, 4);
  }
  assert.doesNotMatch(source, /mockPlans|localStorage|sessionStorage|indexedDB/);
});
test('feature-specific empty states include business plans and teams', () => {
  const expected = { discovery: 'ยังไม่มีไอเดียธุรกิจ', analysis: 'ยังไม่มีผลการวิเคราะห์', tutor: 'ยังไม่มีเนื้อหาการเรียนรู้', 'planner?view=form': 'ยังไม่มีแผนธุรกิจ', growth: 'ยังไม่มีข้อมูลลูกค้า' };
  for (const [route, text] of Object.entries(expected)) assert.ok(app(`#/${route}`).get('main').innerHTML.includes(text));
  assert.match(app('#/planner?view=form').get('main').innerHTML, /ยังไม่มีข้อมูลทีมงาน/);
});
test('presentation supports loading, success and error without fabricating content', () => {
  const { context } = app();
  for (const status of ['empty', 'loading', 'success', 'error']) {
    const html = vm.runInContext(`resultState({ status: '${status}', title: '<external>', message: '&message' })`, context);
    assert.ok(html.includes('&lt;external&gt;'));
    assert.ok(html.includes('&amp;message'));
    assert.equal(html.includes('class="skeleton"'), status === 'loading');
    assert.ok(html.includes(`aria-busy="${status === 'loading'}"`));
  }
});
test('real plan presentation escapes text and retains bounded progress rendering', () => {
  const { context } = app();
  assert.match(vm.runInContext('planList([])', context), /ยังไม่มีแผนธุรกิจ/);
  for (const [value, expected] of [[-1, 0], [150, 100], [42, 42]]) {
    const html = vm.runInContext(`planList([{name: '<record>', updated: '&date', progress: ${value}}])`, context);
    assert.ok(html.includes(`value="${expected}"`));
    assert.ok(html.includes('&lt;record&gt;'));
    assert.ok(html.includes('&amp;date'));
  }
  assert.doesNotMatch(vm.runInContext("planList([{name: 'record', updated: '', progress: null}])", context), /<progress/);
});
test('placeholder actions open an informative dialog', () => {
  const { listeners, get } = app();
  listeners.click({ target: { closest(selector) { return selector === '[data-notice]' ? { dataset: { notice: 'ตัวอย่าง' } } : null; } } });
  assert.equal(get('notice-message').textContent, 'ตัวอย่าง');
  assert.equal(get('notice').open, true);
});
test('planner entry offers both paths before showing the unchanged form', () => {
  const html = app('#/planner').get('main').innerHTML;
  assert.match(html, /คุณมีไอเดียธุรกิจแล้วหรือยัง/);
  assert.match(html, /href="#\/idea-chat"/);
  assert.match(html, /href="#\/planner\?view=form"/);
  assert.doesNotMatch(html, /id="business-form"/);
  const form = app('#/planner?view=form').get('main').innerHTML;
  for (const field of ['ชื่อแผนธุรกิจ', 'เป้าหมายของธุรกิจ', 'ทีมงานและทรัพยากรที่มี']) assert.ok(form.includes(field));
  assert.match(form, /เปลี่ยนตัวเลือก/);
});
test('chat starts with approved welcome, seven chips and a return link', () => {
  const { get } = app('#/idea-chat');
  assert.match(get('main').innerHTML, /href="#\/planner"/);
  assert.equal((get('main').innerHTML.match(/data-chat-prompt=/g) || []).length, 7);
  assert.match(get('main').innerHTML, /Gemini · ผู้ช่วย/);
  assert.match(get('conversation').innerHTML, /สวัสดีครับ 👋/);
  assert.match(get('conversation').innerHTML, /คุณสนใจเรื่องอะไรเป็นพิเศษ/);
  assert.doesNotMatch(get('conversation').innerHTML, /user-message/);
});
test('chat submit escapes text, receives assistant reply and clears composer', async () => {
  const { get, listeners, context } = app('#/idea-chat');
  get('chat-input').value = '  <img src=x onerror=alert(1)>\nความสนใจ  ';
  await vm.runInContext('sendChat()', context);
  const html = get('conversation').innerHTML;
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.equal((html.match(/assistant-message/g) || []).length, 2);
  assert.equal((html.match(/user-message/g) || []).length, 1);
  assert.equal(get('chat-input').value, '');
  assert.equal(get('chat-input').focused, true);
  assert.match(get('chat-status').textContent, /คำตอบจาก AI อาจคลาดเคลื่อน/);
});
test('empty and oversized messages are not added; Enter respects Shift and IME', () => {
  const { get, listeners, context } = app('#/idea-chat');
  const key = extras => ({ target: { id: 'chat-input' }, key: 'Enter', preventDefault() { this.prevented = true; }, ...extras });
  get('chat-input').value = '   ';
  listeners.keydown(key());
  assert.equal(vm.runInContext('chatMessages.length', context), 0);
  get('chat-input').value = 'x'.repeat(2001);
  listeners.keydown(key());
  assert.equal(vm.runInContext('chatMessages.length', context), 0);
  get('chat-input').value = 'สนใจการศึกษา';
  for (const extras of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const event = key(extras); listeners.keydown(event); assert.equal(event.prevented, undefined);
  }
  assert.equal(vm.runInContext('chatMessages.length', context), 0);
  listeners.keydown(key());
  assert.equal(vm.runInContext('chatMessages.length', context), 1);
});
test('chips fill editable input; navigation retains memory; clear and reload reset it', async () => {
  const { get, listeners, context } = app('#/idea-chat');
  listeners.click({ target: { closest(selector) { return selector === '[data-chat-prompt]' ? { dataset: { chatPrompt: 'เทคโนโลยี' } } : null; } } });
  assert.equal(get('chat-input').value, 'เทคโนโลยี');
  assert.equal(vm.runInContext('chatMessages.length', context), 0);
  await vm.runInContext('sendChat()', context);
  context.location.hash = '#/planner'; listeners.hashchange();
  context.location.hash = '#/idea-chat'; listeners.hashchange();
  assert.match(get('conversation').innerHTML, /เทคโนโลยี/);
  assert.doesNotMatch(app('#/idea-chat').get('conversation').innerHTML, /user-message/);
  get('chat-input').value = 'draft';
  listeners.click({ target: { closest(selector) { return selector === '[data-clear-chat]' ? {} : null; } } });
  assert.equal(vm.runInContext('chatMessages.length', context), 0);
  assert.equal(get('chat-input').value, '');
  assert.doesNotMatch(get('conversation').innerHTML, /user-message/);
});
test('failed calls restore draft and exclude failed turns from next context', async () => {
  const payloads = [];
  const { get, context } = app('#/idea-chat', async (_, init) => {
    payloads.push(JSON.parse(init.body));
    return payloads.length === 1 ? { ok: false, json: async () => ({ error: 'ถึงเพดานการใช้งาน' }) } : { ok: true, json: async () => ({ reply: 'คำถามถัดไป' }) };
  });
  get('chat-input').value = 'ข้อความครั้งแรก';
  await vm.runInContext('sendChat()', context);
  assert.equal(get('chat-input').value, 'ข้อความครั้งแรก');
  assert.match(get('chat-status').textContent, /ถึงเพดาน/);
  assert.equal(get('chat-send').disabled, false);
  get('chat-input').value = 'ลองใหม่';
  await vm.runInContext('sendChat()', context);
  assert.equal(payloads[1].content, 'ลองใหม่');
  assert.equal(payloads[1].messages, undefined);
});
test('loading blocks duplicate sends and switching conversations until completion', async () => {
  let complete; let calls=0;
  const {get,context}=app('#/idea-chat',()=>{calls++;return new Promise(resolve=>{complete=()=>resolve({ok:true,json:async()=>({reply:'คำตอบ'})});});});
  get('chat-input').value='ธุรกิจออนไลน์';
  const first=vm.runInContext('sendChat()',context);
  assert.equal(get('chat-send').disabled,true);
  await vm.runInContext('sendChat()',context);
  vm.runInContext('newChat()',context);
  assert.equal(vm.runInContext('chatMessages.length',context),1);
  assert.equal(calls,1); complete(); await first;
  assert.equal(get('chat-send').disabled,false);
});
test('client sends session and message IDs, never client-authored assistant history', async () => {
  let payload;const {get,context}=app('#/idea-chat',async(_,init)=>{payload=JSON.parse(init.body);return{ok:true,json:async()=>({reply:'ตอบ'})};});
  get('chat-input').value='ความสนใจของฉัน'; await vm.runInContext('sendChat()',context);
  assert.equal(payload.content,'ความสนใจของฉัน');assert.ok(payload.sessionId);assert.ok(payload.messageId);assert.equal(payload.messages,undefined);
});
