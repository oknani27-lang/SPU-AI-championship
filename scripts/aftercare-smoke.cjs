const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3108';
const source = process.env.AFTERCARE_NOTE_PATH ? fs.readFileSync(process.env.AFTERCARE_NOTE_PATH, 'utf8').trim() : 'ข้อความสมมติสำหรับทดสอบ แพทย์แจ้งให้จดบันทึกอาการไว้พูดคุยในการนัดครั้งหน้า นำเอกสารผลตรวจมาด้วย นัดติดตามวันที่ 28 พฤศจิกายน';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.request.post(base + '/api/auth/demo', { data: {} });
    const invalid = await page.request.post(base + '/api/ai/aftercare', { headers: { origin: base }, data: { text: source, consent: false } });
    assert.equal(invalid.status(), 400);
    const hostile = await page.request.post(base + '/api/ai/aftercare', { headers: { origin: 'https://other.invalid' }, data: { text: source, consent: true } });
    assert.equal(hostile.status(), 403);
    await page.goto(base + '/doctor?tab=aftercare');
    const input = page.getByLabel('ข้อความจากแพทย์', { exact: true });
    await input.fill(source);
    const submit = page.getByRole('button', { name: 'สรุปให้อ่านง่าย', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await page.getByLabel('ยินยอมส่งข้อความนี้ให้ Gemini เพื่อสรุป').check();
    assert.equal(await submit.isEnabled(), true);
    if (process.env.LIVE_AI_TEST !== 'true') {
      await page.route('**/api/ai/aftercare', route => route.fulfill({ json: { summary: { overview: 'ใจความสำคัญจากข้อความที่ให้มา', sections: [{ category: 'care', text: 'จดอาการไว้คุยกับแพทย์ครั้งหน้า', source: 'แพทย์แจ้งให้จดบันทึกอาการไว้พูดคุยในการนัดครั้งหน้า' }], questions: [] }, provider: 'test-fixture' } }));
    }
    const response = page.waitForResponse(r => r.url().endsWith('/api/ai/aftercare') && r.request().method() === 'POST');
    await submit.click();
    const result = await response;
    const data = await result.json();
    assert.equal(result.status(), 200, 'AI response: ' + (data.details?.reason || data.code || 'unavailable'));
    if (process.env.LIVE_AI_TEST === 'true') assert.ok(data.provider.startsWith('gemini:'));
    await page.getByRole('region', { name: 'ผลสรุปจาก AI' }).waitFor();
    let repeatedRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/ai/aftercare') && request.method() === 'POST') repeatedRequests++; });
    await submit.click();
    await page.getByText('ใช้ผลสรุปเดิม · ไม่ได้เรียก AI ซ้ำ', { exact: true }).waitFor();
    assert.equal(repeatedRequests, 0, 'Identical text must reuse the in-memory summary');
    const copy = page.getByRole('button', { name: 'คัดลอกสรุป', exact: true });
    assert.equal(await copy.isDisabled(), true);
    await page.getByLabel('ตรวจทานกับต้นฉบับแล้ว').check();
    assert.equal(await copy.isEnabled(), true);
    await page.getByText('ดูข้อความต้นฉบับ', { exact: true }).first().click();
    assert.ok(await page.locator('blockquote').first().isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    fs.mkdirSync('outputs', { recursive: true });
    await page.screenshot({ path: 'outputs/aftercare-mobile.png', fullPage: true });
    await input.fill(source + ' ข้อความแก้ไข');
    assert.equal(await page.getByRole('region', { name: 'ผลสรุปจาก AI' }).count(), 0);
    await page.getByRole('button', { name: 'ล้างข้อความ', exact: true }).click();
    assert.equal(await input.inputValue(), '');
    assert.deepEqual(errors, []);
    console.log('Aftercare passed: consent, authorization boundary, summary, evidence, review, mobile and stale-result clearing. Provider: ' + data.provider);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
