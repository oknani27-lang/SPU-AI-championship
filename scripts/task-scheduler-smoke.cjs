// UI regression check: synthetic input, deterministic responses, no provider calls or schedule writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const { parseThaiTextDeterministically, proposeDailySchedule } = require('../src/lib/ai/service.ts');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3001';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.request.post(base + '/api/auth/demo', { data: {} });
    let extractionCalls = 0;
    await page.route('**/api/ai/text-to-task', async route => {
      extractionCalls++;
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { ...parseThaiTextDeterministically(body.text, body.default_day_of_week), provider: 'deterministic_fallback', used_fallback: true, fallback_reason: 'gemini_timeout' } });
    });
    await page.route('**/api/ai/schedule', async route => {
      const body = route.request().postDataJSON();
      const result = await proposeDailySchedule({ ...body, forceFallback: true });
      await route.fulfill({ json: result.response });
    });
    await page.goto(base + '/schedule');
    const input = page.getByLabel('พิมพ์รายการงานดูแลผู้สูงอายุ');
    await input.fill(fs.readFileSync('scripts/fixtures/daily-tasks.txt', 'utf8'));
    await page.getByRole('button', { name: 'แยกงานด้วย AI', exact: true }).click();
    await page.getByText('ตรวจรายการ (14 รายการ)', { exact: true }).waitFor();
    assert.equal(extractionCalls, 1);
    await page.getByRole('button', { name: 'ส่งไปให้ AI จัดเรียงตาราง', exact: true }).click();
    const approve = page.getByRole('button', { name: 'อนุมัติและบันทึกตาราง (14 งาน)', exact: true });
    await approve.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('อนุมัติและบันทึกตาราง (14 งาน)') && !button.disabled));
    assert.equal(await approve.isEnabled(), true);
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await input.fill('ข้อความใหม่ที่ยังไม่ได้แยกงาน');
    assert.equal(await page.getByText('ตรวจรายการ (14 รายการ)', { exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log('Task UI passed: 14 tasks, dependency handoff, valid schedule review, stale-result clearing and mobile width. No real AI requests or schedule writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
