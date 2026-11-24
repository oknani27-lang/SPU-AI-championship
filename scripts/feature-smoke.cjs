// End-to-end checks use the application's real Demo APIs, never live credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3108';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    assert.equal((await page.request.post(base + '/api/auth/demo', { data: {} })).status(), 200);
    const input = { title: 'QA นัดแพทย์ <sample>', event_type: 'doctor', description: 'รายการทดสอบ ไม่ใช่การจองจริง', start_date: '2026-11-28', end_date: '2026-11-28', start_time: '09:30', end_time: '10:00', recurrence: 'weekly', reminder_minutes: 5 };
    const created = await page.request.post(base + '/api/calendar/events', { data: input });
    assert.equal(created.status(), 201); const { event } = await created.json();
    assert.equal(event.event_type, 'doctor');
    try {
      await page.goto(base + '/doctor?event=' + event.id + '&date=2026-11-28');
      await page.getByText(input.title, { exact: true }).first().waitFor();
      assert.equal(await page.locator('sample').count(), 0);
      await page.goto(base + '/calendar?event=' + event.id + '&date=2026-11-28');
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'ปิดหน้าต่าง', exact: true }).click();
      const future = await page.request.patch(base + '/api/calendar/events/' + event.id, { data: { title: 'QA นัดถัดไป', edit_scope: 'future', occurrence_date: '2026-12-05', start_date: '2026-12-05', end_date: '2026-12-05' } });
      assert.equal(future.status(), 200); const changed = await future.json();
      assert.equal(changed.split_event.event_type, 'doctor');
      await page.request.delete(base + '/api/calendar/events/' + changed.split_event.id);
      assert.equal((await page.request.post(base + '/api/calendar/events', { data: { ...input, start_time: '10:00' } })).status(), 400);
      assert.equal((await page.request.get(base + '/api/calendar/events?start=2026-02-31&end=2026-03-01')).status(), 400);
      await page.goto(base + '/doctor');
      await page.getByRole('button', { name: 'โรงพยาบาล', exact: true }).click();
      fs.mkdirSync('outputs', { recursive: true });
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow at ' + width);
        if (width !== 768) await page.screenshot({ path: 'outputs/v2-doctor-' + width + '.png', fullPage: true });
      }
      await page.getByRole('button', { name: /โรงพยาบาลตัวอย่าง A/ }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'โทร', exact: true }).click();
      await page.getByText('โทร: ช่องทางตัวอย่าง ยังไม่เปิดใช้งาน', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'ปิดหน้าต่าง', exact: true }).click();
      await page.goto(base + '/settings');
      await page.getByText(/Push/).first().waitFor();
      const push = await page.request.get(base + '/api/push/config'); assert.equal(push.status(), 200);
      const config = await push.json(); assert.equal(config.configured, false);
      await page.goto(base + '/calendar?new=doctor');
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.locator('#cal-ev-type').inputValue(), 'doctor');
      await page.locator('#cal-ev-title').fill('QA UI Doctor');
      const saveResponse = page.waitForResponse(r => r.url().endsWith('/api/calendar/events') && r.request().method() === 'POST');
      await page.locator('button[form="calendar-event-form"][type="submit"]').click();
      const saved = await (await saveResponse).json();
      await page.waitForURL('**/doctor?**');
      await page.getByText('QA UI Doctor', { exact: true }).first().waitFor();
      await page.request.delete(base + '/api/calendar/events/' + saved.event.id);
      assert.deepEqual(errors, []);
      console.log('Feature smoke passed: actual Demo CRUD, doctor links, recurrence, validation, responsive layout and Demo Push isolation.');
    } finally { await page.request.delete(base + '/api/calendar/events/' + event.id); }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
