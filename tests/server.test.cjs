const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, generateReply, validateMessages, MODEL } = require('../server.cjs');
const messages = [{ role: 'user', content: 'สนใจธุรกิจออนไลน์' }];
const goodResponse = () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'คุณมีทักษะอะไรบ้างครับ?' }] } }] }) });
async function setup(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bizplan-test-'));
  const usageFile = path.join(temp, 'usage.json');
  const storage = { handle: async () => false, authenticate: async () => ({user:{id:'test-owner'}}), startTurn: async (_,body) => ({messages:body.messages}), finishTurn: async (_,__,reply) => reply };
  const server = createApp({ storage, key: 'test-only', usageFile, fetchImpl: async () => goodResponse(), ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });
  return { origin, usageFile, post: (body = { messages }, headers = {}) => fetch(origin + '/api/idea-chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }) };
}
test('valid chat uses server key header, fixed model and bounded generation config', async t => {
  let sent;
  const { post } = await setup(t, { fetchImpl: async (url, init) => { sent = { url, init }; return goodResponse(); } });
  const response = await post();
  assert.equal(response.status, 200);
  assert.match((await response.json()).reply, /ทักษะ/);
  assert.ok(sent.url.includes(MODEL));
  assert.ok(!sent.url.includes('test-only'));
  assert.equal(sent.init.headers['x-goog-api-key'], 'test-only');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.generationConfig.maxOutputTokens, 512);
  assert.ok(body.systemInstruction.parts[0].text.includes('ทีละหนึ่งคำถาม'));
});
test('history validation rejects invalid roles, empty, excessive and oversized content', () => {
  for (const body of [null, {}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'user', content: ' ' }] }, { messages: [{ role: 'user', content: 'x'.repeat(2001) }] }, { messages: Array(11).fill(messages[0]) }, { messages: [messages[0], { role: 'assistant', content: 'a' }] }]) assert.throws(() => validateMessages(body));
  const history = [messages[0], { role: 'assistant', content: 'คำถาม' }, messages[0]];
  assert.deepEqual(validateMessages({ messages: history }).map(m => m.role), ['user', 'model', 'user']);
  assert.throws(() => validateMessages({ messages: [messages[0], { role: 'assistant', content: 'a'.repeat(4000) }, { role: 'user', content: 'a'.repeat(2000) }, { role: 'assistant', content: 'a'.repeat(3000) }, messages[0]] }));
});
test('secrets and server files are never served; public assets and original routes work', async t => {
  const { origin, post } = await setup(t);
  for (const file of ['/.env', '/.env.example', '/server.cjs', '/package.json', '/.runtime/usage.json', '/%2eenv', '/../.env', '/app.js?secret']) assert.equal((await fetch(origin + file)).status, 404);
  for (const file of ['/', '/app.js', '/styles.css']) assert.equal((await fetch(origin + file)).status, 200);
  assert.equal((await post({ messages }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ messages }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('x'.repeat(40001))).status, 413);
});
test('rate limit reserves attempts before calling provider and survives daily cap file', async t => {
  let calls = 0;
  const { post, usageFile } = await setup(t, { fetchImpl: async () => { calls++; return goodResponse(); } });
  for (let i = 0; i < 5; i++) assert.equal((await post()).status, 200);
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.equal(calls, 5);
  assert.equal(JSON.parse(fs.readFileSync(usageFile)).requests, 5);
  const cap = await setup(t);
  fs.writeFileSync(cap.usageFile, JSON.stringify({ day: new Date().toISOString().slice(0, 10), requests: 100 }));
  assert.equal((await cap.post()).status, 429);
  fs.writeFileSync(cap.usageFile, 'broken');
  assert.equal((await cap.post()).status, 503);
});
test('missing key, provider failures and blocked output return safe errors', async t => {
  assert.equal((await (await setup(t, { key: '' })).post()).status, 503);
  for (const status of [400, 403, 429, 500]) {
    const { post } = await setup(t, { fetchImpl: async () => ({ ok: false, status }) });
    const response = await post();
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.ok(!(await response.text()).includes('test-only'));
  }
  const { post } = await setup(t, { fetchImpl: async () => ({ ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }) });
  assert.equal((await post()).status, 502);
  await assert.rejects(generateReply(validateMessages({ messages }), { key: 'test-only', timeout: 5, fetchImpl: async (_, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)); setTimeout(() => {}, 10); }) }), error => error.status === 504);
});
test('parallel requests from same IP are rejected without another upstream call', async t => {
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { post } = await setup(t, { fetchImpl: () => { started(); return new Promise(resolve => { finish = () => resolve(goodResponse()); }); } });
  const first = post();
  await ready;
  try { assert.equal((await post()).status, 429); } finally { finish(); }
  assert.equal((await first).status, 200);
});
