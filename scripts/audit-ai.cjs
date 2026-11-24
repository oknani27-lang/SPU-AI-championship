// Opt-in live-provider audit, using only synthetic nonmedical data and the local Demo store.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const base = process.env.CALENDAR_BASE_URL || 'http://localhost:3108';
const cases = [
  ['text_to_task', '/api/ai/text-to-task', { text: 'วันอังคาร 09:00 รดน้ำต้นไม้ 15 นาที และ 10:00 จัดหนังสือ 20 นาที', default_day_of_week: 2 }],
  ['schedule_generator', '/api/ai/schedule', { day_of_week: 2, tasks: [
    { temp_id: 'audit-water', title: 'รดน้ำต้นไม้', preferred_time: '09:00', duration_minutes: 15, priority: 'low', is_fixed_time: true, is_medically_prescribed: false },
    { temp_id: 'audit-books', title: 'จัดหนังสือ', duration_minutes: 20, priority: 'low', is_fixed_time: false, is_medically_prescribed: false },
  ] }],
  ['daily_summary', '/api/ai/daily-summary', { date: '2026-11-24' }],
  ['rest_suggestions', '/api/ai/rest-suggestions', { date: '2026-11-24' }],
];
function latestDemoTelemetry(userId, operation, after) {
  const dbPath = path.resolve('.careplan-demo-store/db.json');
  if (!fs.existsSync(dbPath)) return null;
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const entry = [...(db.ai_logs || [])].reverse().find(log => log.user_id === userId && log.operation_type === operation && Date.parse(log.created_at) >= after);
  return entry && { provider: entry.provider, used_fallback: entry.used_fallback, status: entry.status, latency_ms: entry.latency_ms };
}
(async () => {
  if (process.env.LIVE_AI_AUDIT !== 'true') throw new Error('Set LIVE_AI_AUDIT=true to authorize four live AI requests.');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_PATH ? { executablePath: process.env.PLAYWRIGHT_BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const auth = await page.request.post(base + '/api/auth/demo', { data: {} });
    if (!auth.ok()) throw new Error('Demo authentication failed: ' + auth.status());
    const session = await (await page.request.get(base + '/api/auth/session')).json();
    if (session.mode !== 'demo') throw new Error('Audit requires Demo mode; refusing to write Live data.');
    for (const [feature, route, data] of cases) {
      if (process.env.AI_AUDIT_FEATURES && !process.env.AI_AUDIT_FEATURES.split(',').includes(feature)) continue;
      const started = Date.now();
      try {
        const response = await page.request.post(base + route, { headers: { origin: base }, data, timeout: 45000 });
        const result = await response.json();
        const direct = feature === 'daily_summary' ? result.summary : result;
        const telemetry = latestDemoTelemetry(session.user.id, feature, started);
        console.log(JSON.stringify({ feature, http: response.status(), provider: direct?.provider || direct?.ai_provider || telemetry?.provider || null, used_fallback: direct?.used_fallback ?? telemetry?.used_fallback ?? null, items: result.extracted_tasks?.length ?? result.proposed_tasks?.length ?? result.suggestions?.length ?? null, code: result.code || null, reason: result.fallback_reason || result.details?.reason || null, telemetry, elapsed_ms: Date.now() - started }));
      } catch (error) { console.log(JSON.stringify({ feature, error: error.name, elapsed_ms: Date.now() - started })); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
