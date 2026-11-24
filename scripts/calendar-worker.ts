import fs from "node:fs";
import { runPushWorker } from "../src/lib/push/worker";
for (const name of [".env.local", ".env"]) if (fs.existsSync(name)) process.loadEnvFile(name);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
async function main() {
  const once = process.argv.includes("--once");
  do {
    const started = Date.now();
    try { console.log(new Date().toISOString(), JSON.stringify(await runPushWorker())); }
    catch (e) { console.error("Calendar push worker failed:", e instanceof Error ? e.message : "Unknown failure"); if (once) process.exitCode = 1; }
    if (once || stopping) break;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); process.off("SIGINT", done); process.off("SIGTERM", done); resolve(); };
      const timer = setTimeout(done, Math.max(1000, 30000 - (Date.now() - started)));
      process.once("SIGINT", done); process.once("SIGTERM", done);
    });
  } while (!stopping);
}
void main();
