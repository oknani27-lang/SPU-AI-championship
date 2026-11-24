import { describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireAuthContext: vi.fn(async () => ({ userId: "test-owner", store: {} })) }));
vi.mock("@/lib/auth", () => auth);
import { POST as summaryPost, GET as summaryGet } from "@/app/api/ai/daily-summary/route";
import { POST as restPost, GET as restGet } from "@/app/api/ai/rest-suggestions/route";
import { POST as extractPost } from "@/app/api/ai/text-to-task/route";
import { POST as schedulePost } from "@/app/api/ai/schedule/route";
import { POST as approvePost } from "@/app/api/schedule/approve/route";

describe("AI route invalid input", () => {
  it("rejects duplicate/cyclic draft IDs and overlapping approvals before any store write", async () => {
    const draft = { temp_id: "a", title: "ซักผ้า", duration_minutes: 40 };
    for (const tasks of [[draft, draft], [{ ...draft, depends_on_temp_id: "b" }, { ...draft, temp_id: "b", depends_on_temp_id: "a" }]]) {
      expect((await schedulePost(new Request("https://app.test/api/ai/schedule", { method: "POST", body: JSON.stringify({ day_of_week: 3, tasks }) }))).status).toBe(400);
    }
    const task = { ...draft, description: "", scheduled_time: "09:00", priority: "medium", is_fixed_time: false, is_medically_prescribed: false, depends_on_temp_id: null };
    expect((await approvePost(new Request("https://app.test/api/schedule/approve", { method: "POST", body: JSON.stringify({ day_of_week: 3, tasks: [task, { ...task, temp_id: "b", scheduled_time: "09:20" }] }) }))).status).toBe(400);
  });
  it("rejects malformed JSON instead of silently generating today's summary or suggestions", async () => {
    for (const post of [summaryPost, restPost, extractPost, schedulePost, approvePost]) {
      const result = await post(new Request("https://app.test/api/ai/test", { method: "POST", body: "{" }));
      expect(result.status).toBe(400);
    }
  });
  it("rejects impossible dates on both reads and generation before accessing data", async () => {
    for (const post of [summaryPost, restPost]) {
      const result = await post(new Request("https://app.test/api/ai/test", { method: "POST", body: JSON.stringify({ date: "2026-02-31" }) }));
      expect(result.status).toBe(400);
    }
    for (const get of [summaryGet, restGet]) {
      expect((await get(new Request("https://app.test/api/ai/test?date=2026-02-31"))).status).toBe(400);
    }
  });
});
