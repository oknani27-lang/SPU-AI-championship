const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3001';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.request.post(base + '/api/auth/demo', { data: {} });
    await page.goto(base + '/schedule'); await page.waitForLoadState('networkidle');
    const nav = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
    await nav.evaluate(node => { window.savedCarePlanNav = node; });
    let reminderReads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/reminders' && request.method() === 'GET') reminderReads++; });
    const measurements = [];
    for (const path of ['/doctor', '/calendar', '/history', '/summary', '/settings', '/schedule', '/doctor', '/calendar', '/schedule']) {
      const link = nav.locator(`a[href="${path}"]`);
      await link.hover();
      const start = Date.now();
      await link.click();
      await page.waitForURL(url => url.pathname === path);
      await page.locator('main h1').first().waitFor();
      measurements.push({ path, navigationMs: Date.now() - start });
      assert.ok(await nav.evaluate(node => node === window.savedCarePlanNav), 'Sidebar must survive navigation');
      assert.equal(await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).count(), 1);
      await page.waitForLoadState('networkidle');
    }
    assert.equal(reminderReads, 0, 'Navigation must not remount/reload notifications');
    await page.goto(base + '/login');
    assert.equal(await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).count(), 0);
    await page.goto(base + '/share/invalid-test-token'); await page.waitForLoadState('networkidle');
    assert.equal(await page.getByRole('navigation', { name: 'เมนูหลัก', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ measurements, reminderReadsDuringNavigation: reminderReads, publicRoutesUnwrapped: true, browserErrors: errors.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
