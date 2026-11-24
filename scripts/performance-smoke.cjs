const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3001';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.request.post(base + '/api/auth/demo', { data: {} });
    const calls = [];
    page.on('request', request => { if (request.url().includes('/api/')) calls.push(request.url()); });
    await page.goto(base + '/schedule'); await page.waitForLoadState('networkidle');
    assert.equal(calls.some(url => /occurrences\?date=/.test(url)), false, 'Day data must come from the loaded week');
    const initial = calls.length; calls.length = 0;
    const tabs = page.getByRole('tablist', { name: 'เลือกวันในสัปดาห์' }).getByRole('tab');
    for (let index = 0; index < 7; index++) {
      await tabs.nth(index).click();
      await tabs.nth(index).getAttribute('aria-selected').then(value => assert.equal(value, 'true'));
    }
    await page.waitForTimeout(200);
    assert.equal(calls.length, 0, 'Switching loaded days must not refetch the week');
    await page.getByRole('button', { name: 'สัปดาห์ถัดไป', exact: true }).click();
    await page.waitForLoadState('networkidle');
    assert.ok(calls.some(url => url.includes('weekStart=')), 'A new week must fetch fresh data');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initialRequests: initial, requestsForSevenDaySwitches: 0, nextWeekRequests: calls.length, browserErrors: errors.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
