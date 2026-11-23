import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DemoFileStore } from "@/lib/store/demo-store";
import { computeDailyMetrics } from "@/lib/store/types";
import {
  parseTextToTasks,
  proposeDailySchedule,
  buildDailySummary,
  buildRestSuggestions,
} from "@/lib/ai/service";
import { processRemindersForUser } from "@/lib/reminders";
import { addDays, getThaiTodayDate, getThaiWeekDates } from "@/lib/timezone";

describe("Phase 7 — Complete 19-Step Judge End-to-End Workflow & Frontend A11y/Responsive Audit", () => {
  let tmpDir: string;
  let store: DemoFileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "careplan-e2e-"));
    store = new DemoFileStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes all 19 hackathon judge workflow steps end-to-end with persistent storage", async () => {
    // Step 1: Register a fresh caregiver account
    const reg = await store.registerUser({
      email: "judge@careplan.test",
      password: "Password123!",
      full_name: "กรรมการทดสอบ",
      care_recipient_name: "คุณแม่สมใจ",
      care_recipient_age: 75,
    });
    const userId = reg.user.id;
    expect(reg.user.full_name).toBe("กรรมการทดสอบ");

    // Step 2: Select Monday of the current Thai week
    const today = getThaiTodayDate();
    const thisWeek = getThaiWeekDates(today);
    const mondayDate = thisWeek.find((d) => d.day_of_week === 1)!.date;
    const nextMondayDate = addDays(mondayDate, 7);

    // Step 3: Type three care activities (Text-to-Task, typed text only)
    const parsed = await parseTextToTasks({
      text: "วันจันทร์ 8 โมงเตรียมอาหารให้แม่ 9 โมงจัดยา แล้วบ่ายสองพาไปหาหมอ",
      default_day_of_week: 1,
      forceFallback: true,
    });
    expect(parsed.response.extracted_tasks.length).toBeGreaterThanOrEqual(3);

    // Link task 2 (meds) to depend on task 1 (breakfast) to test Step 13 dependent notification
    const draftTasks = parsed.response.extracted_tasks.map((t, idx) => ({
      temp_id: t.temp_id,
      title: t.title,
      description: t.description,
      preferred_time: t.preferred_time ?? undefined,
      duration_minutes: t.duration_minutes,
      priority: t.priority,
      is_fixed_time: t.is_fixed_time,
      is_medically_prescribed: t.is_medically_prescribed,
      depends_on_temp_id: idx === 1 ? parsed.response.extracted_tasks[0].temp_id : null,
    }));

    // Step 4: Generate chronological schedule using AI Process 1
    const proposal = await proposeDailySchedule({
      day_of_week: 1,
      tasks: draftTasks,
      careRecipientName: "คุณแม่สมใจ",
      forceFallback: true,
    });
    expect(proposal.response.proposed_tasks.length).toBe(draftTasks.length);
    expect(proposal.response.medical_safety_note).toContain("แพทย์");

    // Step 5: Review and approve/save the schedule
    const saved = await store.approveScheduleTasks(userId, {
      day_of_week: 1,
      effective_from_date: mondayDate,
      tasks: proposal.response.proposed_tasks,
    });
    expect(saved.templates.length).toBe(draftTasks.length);

    // Step 6: View saved activities for Monday (materialized & persisted across new store instance)
    const freshStore = new DemoFileStore(tmpDir);
    const monView = await freshStore.getOccurrencesForDate(userId, mondayDate);
    expect(monView.occurrences.length).toBe(draftTasks.length);
    const firstTask = monView.occurrences[0];
    const secondTask = monView.occurrences[1];

    // Step 7: Trigger scheduled reminder for Monday 08:05 (+07:00)
    const simTime = new Date(`${mondayDate}T08:05:00+07:00`);
    const remResult = await processRemindersForUser(freshStore, userId, {
      date: mondayDate,
      now: simTime,
    });
    expect(remResult.delivered.some((n) => n.occurrence_id === firstTask.id)).toBe(true);

    // Step 8 & 9: Open incomplete task and verify editing/deleting is strictly rejected
    const detail = await freshStore.getOccurrenceDetail(userId, firstTask.id);
    expect(detail.occurrence.can_edit_occurrence).toBe(false);
    await expect(freshStore.rejectOccurrenceEdit(userId, firstTask.id)).rejects.toThrow();
    await expect(freshStore.rejectOccurrenceDelete(userId, firstTask.id)).rejects.toThrow();
    await expect(
      freshStore.updateTemplateForFuture(
        userId,
        firstTask.template_id,
        { title: "พยายามแก้ก่อนเสร็จ" },
        mondayDate
      )
    ).rejects.toThrow();

    // Completion without photo MUST fail
    await expect(freshStore.confirmOccurrenceCompletion(userId, firstTask.id)).rejects.toThrow();

    // Step 10 & 11: Attach valid photo and Confirm Success
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const ev = await freshStore.uploadCompletionEvidence(userId, firstTask.id, {
      fileName: "breakfast-proof.png",
      mimeType: "image/png",
      bytes: fakePng,
    });
    expect(ev.evidence.id).toBeTruthy();

    const confirmed = await freshStore.confirmOccurrenceCompletion(
      userId,
      firstTask.id,
      new Date(`${mondayDate}T08:10:00+07:00`)
    );

    // Step 12: Verify task and evidence are locked (immutable)
    expect(confirmed.occurrence.status).toBe("completed");
    expect(confirmed.occurrence.is_locked).toBe(true);
    expect(confirmed.occurrence.evidence[0].locked_at).toBeTruthy();
    await expect(freshStore.rejectOccurrenceEdit(userId, firstTask.id)).rejects.toThrow();

    // Step 13: Verify next dependent task is presented & notified
    expect(confirmed.next_dependent?.id).toBe(secondTask.id);
    expect(
      confirmed.notifications_created.some((n) => n.notification_type === "next_dependent_ready")
    ).toBe(true);

    // Step 14: Modify the completed task's recurring template for a future week
    const updatedTpl = await freshStore.updateTemplateForFuture(
      userId,
      firstTask.template_id,
      {
        title: "เตรียมอาหารเช้าอ่อนๆ (แผนสัปดาห์หน้า)",
        scheduled_time: "07:45",
        effective_from_date: nextMondayDate,
      },
      mondayDate
    );
    expect(updatedTpl.template.title).toBe("เตรียมอาหารเช้าอ่อนๆ (แผนสัปดาห์หน้า)");

    // Step 15: Verify past evidence and history remain 100% unchanged
    const hist = await freshStore.getHistory(userId, 20);
    const pastItem = hist.completed_occurrences.find((o) => o.id === firstTask.id);
    expect(pastItem?.title).toBe(firstTask.title);
    expect(pastItem?.scheduled_time).toBe(firstTask.scheduled_time);
    expect(pastItem?.evidence.length).toBe(1);

    // Step 16: Share weekly schedule (private notes excluded by default) and load public link without login
    const shareLink = await freshStore.createShareLink(userId, {
      scope: "week",
      target_date: mondayDate,
      include_private_notes: false,
      expires_in_days: 7,
    });
    const publicPayload = await freshStore.getPublicSharedSchedule(shareLink.token);
    expect(publicPayload.days.length).toBe(7);
    expect(publicPayload.include_private_notes).toBe(false);

    // Step 17: Generate AI Daily Summary from real verified DB records
    const refreshedMon = await freshStore.getOccurrencesForDate(userId, mondayDate);
    const metrics = computeDailyMetrics(mondayDate, refreshedMon.occurrences);
    const summaryGen = await buildDailySummary({
      date: mondayDate,
      metrics,
      isRestDay: false,
      caregiverName: "กรรมการทดสอบ",
      careRecipientName: "คุณแม่สมใจ",
      forceFallback: true,
    });
    const savedSummary = await freshStore.saveDailySummary(userId, summaryGen.summaryInput);
    expect(savedSummary.metrics.completed_tasks).toBe(1);
    expect(savedSummary.metrics.total_tasks).toBe(draftTasks.length);

    // Step 18: Generate & dismiss an optional rest suggestion (does not affect completion score)
    const restGen = await buildRestSuggestions({
      date: mondayDate,
      occurrences: refreshedMon.occurrences,
      careRecipient: {
        display_name: "คุณแม่สมใจ",
        mobility_level: "homebound",
        requires_supervision: true,
      },
      forceFallback: true,
    });
    const savedRests = await freshStore.replaceRestSuggestions(
      userId,
      mondayDate,
      restGen.suggestions
    );
    expect(savedRests.length).toBeGreaterThan(0);
    const dismissed = await freshStore.updateRestSuggestionStatus(
      userId,
      savedRests[0].id,
      "dismissed"
    );
    expect(dismissed.status).toBe("dismissed");

    // Step 19: Verify next week repeats with the updated future template while keeping untouched tasks
    const nextMonView = await freshStore.getOccurrencesForDate(userId, nextMondayDate);
    expect(nextMonView.occurrences.length).toBe(draftTasks.length);
    expect(
      nextMonView.occurrences.some((o) => o.title === "เตรียมอาหารเช้าอ่อนๆ (แผนสัปดาห์หน้า)")
    ).toBe(true);
    expect(nextMonView.occurrences.every((o) => o.status === "incomplete")).toBe(true);
  });

  it("verifies UI design system compliance, zero voice input, mobile responsiveness & keyboard accessibility", () => {
    const projectRoot = process.cwd();
    const globalsCss = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");
    const appShell = fs.readFileSync(
      path.join(projectRoot, "src/components/layout/AppShell.tsx"),
      "utf8"
    );
    const textComposer = fs.readFileSync(
      path.join(projectRoot, "src/components/care/TextToTaskComposer.tsx"),
      "utf8"
    );
    const sevenDay = fs.readFileSync(
      path.join(projectRoot, "src/components/care/SevenDaySelector.tsx"),
      "utf8"
    );

    // Exact brand tokens present
    expect(globalsCss).toContain("#FAFBF9");
    expect(globalsCss).toContain("#256B4A");
    expect(globalsCss).toContain("#EAF3EC");
    expect(globalsCss).toContain("#B86A32");
    expect(globalsCss).toContain("@media print");

    // No speech / microphone in Text-to-Task
    expect(textComposer.toLowerCase()).not.toContain("speechrecognition");
    expect(textComposer.toLowerCase()).not.toContain("webkitSpeechRecognition".toLowerCase());

    // Mobile & tablet responsive layout & bottom nav in AppShell
    expect(appShell).toContain("lg:hidden");
    expect(appShell).toContain("lg:flex");

    // Keyboard navigation attributes in SevenDaySelector
    expect(sevenDay).toContain("onKeyDown");
    expect(sevenDay).toContain("ArrowRight");
  });
});
