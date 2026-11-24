import {
  THAI_DAY_NAMES,
  type AiScheduleProposalResponse,
  type CareRecipientProfile,
  type DailySummaryMetrics,
  type DailySummaryRecord,
  type DailyTaskOccurrence,
  type DayOfWeek,
  type DraftTaskInput,
  type ProposedScheduleTask,
  type RestSuggestionRecord,
  type TaskPriority,
  type TextToTaskExtractedItem,
  type TextToTaskResponse,
} from "@/types/careplan";
import { callGeminiJson } from "@/lib/ai/gemini";
import { scheduleProblem } from "@/lib/ai/schedule-validation";
import {
  aiScheduleGeminiOutputSchema,
  dailySummaryGeminiOutputSchema,
  restSuggestionsGeminiOutputSchema,
  textToTaskGeminiOutputSchema,
} from "@/lib/ai/schemas";
import {
  hhmmToMinutes,
  isValidHHMM,
  minutesToHhmm,
  getThaiDayOfWeek,
  getThaiTodayDate,
  addDays,
} from "@/lib/timezone";

export const MEDICAL_SAFETY_NOTE =
  "ตารางนี้จัดทำขึ้นเพื่อช่วยวางแผนการดูแลประจำวันเท่านั้น ไม่ใช่คำแนะนำทางการแพทย์ กรุณายึดเวลาการรับประทานยาและการรักษาตามคำสั่งแพทย์เป็นหลักเสมอ";

export const DEFAULT_SUPERVISION_SAFETY_NOTE =
  "เพื่อความปลอดภัยของผู้สูงอายุ กรุณาเลือกกิจกรรมพักผ่อนที่สามารถทำใกล้ชิดในบ้านได้ หรือให้สมาชิกครอบครัวช่วยดูแลแทนก่อนเสมอ ไม่ควรปล่อยผู้สูงอายุที่ต้องมีผู้ดูแลอยู่ตามลำพัง";

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  medical_critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const MEDICAL_KEYWORDS = [
  "จัดยา",
  "กินยา",
  "ทานยา",
  "ป้อนยา",
  "ฉีดอินซูลิน",
  "อินซูลิน",
  "ฉีดยา",
  "วัดความดัน",
  "เจาะน้ำตาล",
  "วัดน้ำตาล",
  "หาหมอ",
  "พบแพทย์",
  "โรงพยาบาล",
  "คลินิก",
  "ดูดเสมหะ",
  "ฟีดอาหาร",
  "ทำแผล",
  "ล้างแผล",
  "กายภาพ",
  "ออกซิเจน",
];

function isMedicalTitle(text: string): boolean {
  const lower = text.toLowerCase();
  return MEDICAL_KEYWORDS.some((kw) => lower.includes(kw)) || /รับประทานยา|ให้ยา|เตรียมยา|ยาตามฉลาก|ยาหลังอาหาร/.test(lower);
}

function estimateDefaultDuration(title: string): number {
  if (/หาหมอ|พบแพทย์|โรงพยาบาล|คลินิก/.test(title)) return 90;
  if (/อาหาร|ทำกับข้าว|ป้อนข้าว/.test(title)) return 40;
  if (/อาบน้ำ|เช็ดตัว/.test(title)) return 35;
  if (/จัดยา|กินยา|ทานยา|ป้อนยา|ฉีด/.test(title)) return 15;
  if (/วัดความดัน|เจาะน้ำตาล/.test(title)) return 15;
  if (/กายภาพ|ยืดเหยียด|เดิน/.test(title)) return 30;
  return 30;
}

// =============================================================================
// AI PROCESS 1: Propose Daily Schedule
// =============================================================================

function topologicalSortTasks<T extends DraftTaskInput>(tasks: T[]): T[] {
  const byId = new Map<string, T>(tasks.map((t) => [t.temp_id, t]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.temp_id, 0);
    children.set(t.temp_id, []);
  }

  for (const t of tasks) {
    if (
      t.depends_on_temp_id &&
      t.depends_on_temp_id !== t.temp_id &&
      byId.has(t.depends_on_temp_id)
    ) {
      inDegree.set(t.temp_id, (inDegree.get(t.temp_id) ?? 0) + 1);
      children.get(t.depends_on_temp_id)!.push(t.temp_id);
    }
  }

  const compareReady = (a: DraftTaskInput, b: DraftTaskInput): number => {
    const aTime =
      a.preferred_time && isValidHHMM(a.preferred_time)
        ? hhmmToMinutes(a.preferred_time)
        : Number.MAX_SAFE_INTEGER;
    const bTime =
      b.preferred_time && isValidHHMM(b.preferred_time)
        ? hhmmToMinutes(b.preferred_time)
        : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    const prioDiff =
      PRIORITY_WEIGHT[b.priority ?? "medium"] -
      PRIORITY_WEIGHT[a.priority ?? "medium"];
    if (prioDiff !== 0) return prioDiff;
    return a.title.localeCompare(b.title);
  };

  const ready: T[] = tasks
    .filter((t) => (inDegree.get(t.temp_id) ?? 0) === 0)
    .sort(compareReady);
  const ordered: T[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);
    for (const childId of children.get(current.temp_id) ?? []) {
      const nextDeg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, nextDeg);
      if (nextDeg === 0) {
        ready.push(byId.get(childId)!);
        ready.sort(compareReady);
      }
    }
  }

  // Append any cyclic items gracefully without crashing
  for (const t of tasks) {
    if (!ordered.some((o) => o.temp_id === t.temp_id)) {
      ordered.push(t);
    }
  }

  return ordered;
}

interface OccupiedSlot {
  start: number;
  end: number;
  temp_id: string;
}

function findNextNonOverlappingStart(
  desiredStart: number,
  duration: number,
  occupied: OccupiedSlot[]
): number {
  let candidate = Math.max(6 * 60, desiredStart);
  const sorted = [...occupied].sort((a, b) => a.start - b.start);

  for (const slot of sorted) {
    const candidateEnd = candidate + duration;
    if (candidateEnd <= slot.start) {
      break;
    }
    if (candidate < slot.end && candidateEnd > slot.start) {
      candidate = slot.end + 10; // 10-min gentle transition buffer
    }
  }
  return candidate;
}

function buildDeterministicSchedule(
  dayOfWeek: DayOfWeek,
  tasks: DraftTaskInput[]
): Omit<AiScheduleProposalResponse, "used_fallback" | "provider"> {
  const assumptions: string[] = [];
  const missingInfoQuestions: string[] = [];

  const normalizedTasks = tasks.map((t) => {
    const medical = Boolean(t.is_medically_prescribed) || isMedicalTitle(t.title);
    const preferred =
      t.preferred_time && isValidHHMM(t.preferred_time)
        ? t.preferred_time
        : undefined;
    const duration = t.duration_minutes ?? estimateDefaultDuration(t.title);
    const priority: TaskPriority =
      t.priority ?? (medical ? "medical_critical" : "medium");

    if (!t.duration_minutes) {
      assumptions.push(
        `ประมาณระยะเวลาสำหรับ "${t.title}" เป็น ${duration} นาที`
      );
    }
    if (!preferred && medical) {
      missingInfoQuestions.push(
        medical
          ? `งาน "${t.title}" เป็นงานทางการแพทย์ กรุณาระบุเวลาที่แพทย์กำหนดให้ชัดเจน`
          : `งาน "${t.title}" ยังไม่ได้ระบุเวลาที่ต้องการ คุณสะดวกให้ทำช่วงเวลาใดเป็นพิเศษหรือไม่?`
      );
    }

    return {
      ...t,
      preferred_time: preferred,
      duration_minutes: duration,
      priority,
      is_medically_prescribed: medical,
      is_fixed_time: Boolean(t.is_fixed_time) || (medical && Boolean(preferred)),
    };
  });

  const ordered = topologicalSortTasks(normalizedTasks);
  const occupied: OccupiedSlot[] = [];
  const endTimeById = new Map<string, number>();

  // First reserve all medically prescribed / fixed-time tasks with an explicit preferred time
  for (const t of ordered) {
    if ((t.is_medically_prescribed || t.is_fixed_time) && t.preferred_time) {
      const start = hhmmToMinutes(t.preferred_time);
      occupied.push({
        start,
        end: start + t.duration_minutes,
        temp_id: t.temp_id,
      });
    }
  }

  const windowMatch = tasks.map(task => task.description ?? "").join("\n").match(/เริ่มดูแล[^\n]*?(\d{2}:\d{2})\s*ถึง\s*(\d{2}:\d{2})/);
  const rollingCursor = windowMatch ? hhmmToMinutes(windowMatch[1]) : 8 * 60;
  const scheduledMap = new Map<string, ProposedScheduleTask>();

  for (const t of ordered) {
    const predEnd = t.depends_on_temp_id
      ? endTimeById.get(t.depends_on_temp_id)
      : undefined;

    let startMinutes: number;
    let rationale: string;

    if ((t.is_medically_prescribed || t.is_fixed_time) && t.preferred_time) {
      // NEVER silently move medically prescribed or fixed-time tasks
      startMinutes = hhmmToMinutes(t.preferred_time);
      rationale = t.is_medically_prescribed
        ? `คงเวลา ${t.preferred_time} น. ตามเวลาทางการแพทย์ที่กำหนดไว้โดยไม่ขยับเวลา`
        : `คงเวลา ${t.preferred_time} น. ตามเวลาคงที่ที่ผู้ดูแลระบุ`;
      if (predEnd !== undefined && predEnd > startMinutes) {
        missingInfoQuestions.push(
          `งาน "${t.title}" กำหนดเวลา ${t.preferred_time} น. แต่ต่อเนื่องจากงานก่อนหน้าที่สิ้นสุดเวลา ${minutesToHhmm(predEnd)} น. กรุณาตรวจสอบเวลาอีกครั้ง`
        );
      }
    } else {
      const preferredMin = t.preferred_time
        ? hhmmToMinutes(t.preferred_time)
        : rollingCursor;
      const earliestMin =
        predEnd !== undefined ? Math.max(preferredMin, predEnd + 10) : preferredMin;

      const others = occupied.filter((o) => o.temp_id !== t.temp_id);
      startMinutes = findNextNonOverlappingStart(
        earliestMin,
        t.duration_minutes,
        others
      );
      occupied.push({
        start: startMinutes,
        end: startMinutes + t.duration_minutes,
        temp_id: t.temp_id,
      });

      if (predEnd !== undefined) {
        rationale = `จัดวางหลังงานก่อนหน้าเสร็จสิ้น พร้อมเว้นช่วงพักเปลี่ยนผ่าน 10 นาที`;
      } else if (t.preferred_time && startMinutes !== hhmmToMinutes(t.preferred_time)) {
        rationale = `ขยับจาก ${t.preferred_time} น. เป็น ${minutesToHhmm(startMinutes)} น. เพื่อลดการซ้อนทับกับงานสำคัญอื่น`;
        assumptions.push(
          `ปรับเวลา "${t.title}" เป็น ${minutesToHhmm(startMinutes)} น. เพื่อไม่ให้ทับซ้อนกับงานเวลาคงที่`
        );
      } else if (t.preferred_time) {
        rationale = `จัดวางตามเวลาที่ผู้ดูแลต้องการ (${t.preferred_time} น.)`;
      } else {
        rationale = `จัดเรียงตามลำดับความสำคัญและความต่อเนื่องในช่วงเวลาที่ว่าง`;
      }
    }

    const endMinutes = startMinutes + t.duration_minutes;
    endTimeById.set(t.temp_id, endMinutes);
    // Search each flexible task from the day's start; occupied slots enforce spacing.

    scheduledMap.set(t.temp_id, {
      temp_id: t.temp_id,
      title: t.title.trim(),
      description: (t.description ?? "").trim(),
      scheduled_time: minutesToHhmm(startMinutes),
      duration_minutes: t.duration_minutes,
      priority: t.priority,
      is_fixed_time: t.is_fixed_time,
      is_medically_prescribed: t.is_medically_prescribed,
      depends_on_temp_id: t.depends_on_temp_id ?? null,
      rationale,
    });
  }

  const proposedTasks = Array.from(scheduledMap.values()).sort((a, b) =>
    a.scheduled_time.localeCompare(b.scheduled_time)
  );
  const problem = scheduleProblem(proposedTasks);
  if (problem) missingInfoQuestions.push(problem);
  if (windowMatch && proposedTasks.some(task => hhmmToMinutes(task.scheduled_time) < hhmmToMinutes(windowMatch[1]) || hhmmToMinutes(task.scheduled_time) + task.duration_minutes > hhmmToMinutes(windowMatch[2]))) missingInfoQuestions.push("มีงานอยู่นอกช่วงดูแล กรุณาปรับเวลา/ระยะเวลาก่อนบันทึก");

  const dayName = THAI_DAY_NAMES[dayOfWeek].full;
  return {
    day_of_week: dayOfWeek,
    proposed_tasks: proposedTasks,
    assumptions,
    missing_info_questions: missingInfoQuestions,
    medical_safety_note: MEDICAL_SAFETY_NOTE,
    summary_note: `จัดเรียงตารางดูแลสำหรับ${dayName} จำนวน ${proposedTasks.length} รายการ โดยรักษาลำดับความสำคัญและเวลาทางการแพทย์ไว้อย่างครบถ้วน`,
  };
}

export async function proposeDailySchedule(params: {
  day_of_week: DayOfWeek;
  tasks: DraftTaskInput[];
  careRecipientName?: string;
  forceFallback?: boolean;
}): Promise<{
  failure_reason?: string;
  response: AiScheduleProposalResponse;
  telemetry: {
    provider: string;
    model: string;
    used_fallback: boolean;
    status: "success" | "fallback" | "error";
    latency_ms: number;
  };
}> {
  const deterministic = buildDeterministicSchedule(
    params.day_of_week,
    params.tasks
  );
  const dayName = THAI_DAY_NAMES[params.day_of_week].full;

  const systemInstruction = `คุณคือผู้ช่วยวางแผนตารางดูแลผู้สูงอายุ CarePlan (ประเทศไทย โซนเวลา Asia/Bangkok)
กฎเข้มงวด:
1. ตอบกลับเป็น JSON เท่านั้นตามโครงสร้างที่กำหนด
2. ห้ามเปลี่ยนเวลาของงานที่ is_medically_prescribed = true หรือ is_fixed_time = true ที่มี preferred_time ระบุอยู่แล้วเด็ดขาด
3. ต้องจัดลำดับงานที่มี depends_on_temp_id ให้เริ่มหลังจากงานก่อนหน้าเสร็จสิ้น
4. ห้ามให้คำแนะนำทางการแพทย์หรือปรับขนาดยา
5. งานทั่วไปที่ไม่ได้ระบุเวลาให้จัดในช่องว่าง ไม่ต้องถามเวลาทุกรายการ ระบุสมมติฐานเมื่อประมาณระยะเวลา ถ้าข้อมูลจำเป็นขาดจึงถามเพิ่มเติม
6. เขียน rationale สั้นๆ อ่านง่ายเป็นภาษาไทยสำหรับแต่ละงาน
7. ยึดเงื่อนไขใน description เช่น ช่วงดูแล อาหารต้องพร้อมก่อนมื้ออาหาร และช่วงเว้นพัก ห้ามจัดงานทับกัน`;

  const userPrompt = JSON.stringify({
    day_of_week: params.day_of_week,
    day_name_th: dayName,
    care_recipient: params.careRecipientName ?? "ผู้สูงอายุ",
    tasks: params.tasks,
    required_json_shape: {
      proposed_tasks: [
        {
          temp_id: "string (must match input temp_id)",
          title: "string",
          description: "string",
          scheduled_time: "HH:mm",
          duration_minutes: 30,
          priority: "low | medium | high | medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: "string | null",
          rationale: "short Thai explanation",
        },
      ],
      assumptions: ["string"],
      missing_info_questions: ["string"],
      summary_note: "short Thai overview",
    },
  });

  const geminiRes = await callGeminiJson({
    systemInstruction,
    userPrompt,
    schema: aiScheduleGeminiOutputSchema,
    timeoutMs: 20000,
    thinkingLevel: "minimal",
    maxOutputTokens: 8192,
    forceFallback: params.forceFallback,
  });

  if (geminiRes.ok) {
    // Enforce medical/fixed-time immutability even on AI output!
    const inputById = new Map(params.tasks.map((t) => [t.temp_id, t]));
    const proposedIds = geminiRes.data.proposed_tasks.map(task => task.temp_id);
    const allInputsPresent = inputById.size === params.tasks.length &&
      proposedIds.length === params.tasks.length && new Set(proposedIds).size === proposedIds.length &&
      proposedIds.every(id => inputById.has(id));

    if (allInputsPresent) {
      const safeguardedTasks: ProposedScheduleTask[] =
        geminiRes.data.proposed_tasks
          .map((item) => {
            const orig = inputById.get(item.temp_id);
            const isMed =
              Boolean(orig?.is_medically_prescribed) ||
              item.is_medically_prescribed;
            const isFixed = isMed || Boolean(orig?.is_fixed_time) || item.is_fixed_time;
            const lockedTime =
              (isMed || isFixed) &&
              orig?.preferred_time &&
              isValidHHMM(orig.preferred_time)
                ? orig.preferred_time
                : item.scheduled_time;

            return {
              ...item,
              title: orig!.title,
              description: orig!.description ?? "",
              duration_minutes: orig?.duration_minutes ?? item.duration_minutes,
              priority: isMed ? "medical_critical" : item.priority,
              scheduled_time: lockedTime,
              is_medically_prescribed: isMed,
              is_fixed_time: isFixed,
              depends_on_temp_id: orig?.depends_on_temp_id ?? null,
            };
          })
          .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

      const byId = new Map(safeguardedTasks.map(task => [task.temp_id, task]));
      const validOrder = safeguardedTasks.every(task => {
        if (!task.depends_on_temp_id) return true;
        const previous = byId.get(task.depends_on_temp_id);
        return previous && hhmmToMinutes(task.scheduled_time) >= hhmmToMinutes(previous.scheduled_time) + previous.duration_minutes;
      });
      if (validOrder && !scheduleProblem(safeguardedTasks)) {
        const mergedQuestions = Array.from(
          new Set([
            ...(geminiRes.data.missing_info_questions ?? []),
            ...deterministic.missing_info_questions,
          ])
        );

        return {
          response: {
            day_of_week: params.day_of_week,
            proposed_tasks: safeguardedTasks,
            assumptions: geminiRes.data.assumptions ?? [],
            missing_info_questions: mergedQuestions,
            medical_safety_note: MEDICAL_SAFETY_NOTE,
            summary_note: geminiRes.data.summary_note,
            used_fallback: false,
            provider: `gemini:${geminiRes.model}`,
          },
          telemetry: {
            provider: "gemini",
            model: geminiRes.model,
            used_fallback: false,
            status: "success",
            latency_ms: geminiRes.latencyMs,
          },
        };
      }
    }
  }

  return {
    failure_reason: geminiRes.ok ? "ai_output_validation_failed" : geminiRes.reason,
    response: {
      ...deterministic,
      used_fallback: true,
      provider: "deterministic_fallback",
    },
    telemetry: {
      provider: "deterministic_fallback",
      model: geminiRes.model,
      used_fallback: true,
      status: "fallback",
      latency_ms: geminiRes.latencyMs,
    },
  };
}

// =============================================================================
// FEATURE 3: Typed Text-to-Task Thai Parser (NO VOICE / NO SPEECH)
// =============================================================================

const THAI_DAY_REGEX =
  /(?:วัน)?(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)/g;

function mapThaiDayName(token: string): DayOfWeek {
  if (token.includes("จันทร์")) return 1;
  if (token.includes("อังคาร")) return 2;
  if (token.includes("พุธ")) return 3;
  if (token.includes("พฤหัส")) return 4;
  if (token.includes("ศุกร์")) return 5;
  if (token.includes("เสาร์")) return 6;
  return 7;
}

const THAI_NUM_WORDS: Record<string, number> = {
  สิบสอง: 12,
  สิบเอ็ด: 11,
  สิบ: 10,
  เก้า: 9,
  แปด: 8,
  เจ็ด: 7,
  หก: 6,
  ห้า: 5,
  สี่: 4,
  สาม: 3,
  สอง: 2,
  หนึ่ง: 1,
};

function parseThaiNumber(token: string): number | null {
  const trimmed = token.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return THAI_NUM_WORDS[trimmed] ?? null;
}

interface ParsedTimeToken {
  hhmm: string;
  index: number;
  length: number;
}

function findTimeTokens(text: string): ParsedTimeToken[] {
  const results: ParsedTimeToken[] = [];
  const numWordPattern =
    "(?:\\d{1,2}|สิบสอง|สิบเอ็ด|สิบ|เก้า|แปด|เจ็ด|หก|ห้า|สี่|สาม|สอง|หนึ่ง)";

  // Ordered from most specific to general
  const regex = new RegExp(
    [
      // 1. 24-hour clock e.g. 08:00, 14.30 น.
      `(?<clock>(?:[01]?\\d|2[0-3])[:.](?:[0-5]\\d))(?:\\s*น\\.?)?`,
      // 2. เที่ยงคืน / เที่ยงครึ่ง / เที่ยง
      `(?<midnight>เที่ยงคืน)`,
      `(?<noon>เที่ยง(?:\\s*ครึ่ง)?)`,
      // 3. ตี 1..5
      `ตี\\s*(?<tee>${numWordPattern})(?:\\s*(?<teeHalf>ครึ่ง)|\\s*(?<teeMin>\\d{1,2})\\s*นาที)?`,
      // 4. บ่ายโมง / บ่าย 2 / บ่ายสอง
      `บ่าย\\s*(?:(?<baiMong>โมง)|(?<baiNum>${numWordPattern})(?:\\s*โมง)?)(?:\\s*(?<baiHalf>ครึ่ง)|\\s*(?<baiMin>\\d{1,2})\\s*นาที)?`,
      // 5. 1-5 ทุ่ม
      `(?<thum>${numWordPattern})\\s*ทุ่ม(?:\\s*(?<thumHalf>ครึ่ง)|\\s*(?<thumMin>\\d{1,2})\\s*นาที)?`,
      // 6. X โมง (เช้า|เย็น)?
      `(?<mong>${numWordPattern})\\s*โมง(?:\\s*(?<mongPeriod>เช้า|เย็น))?(?:\\s*(?<mongHalf>ครึ่ง)|\\s*(?<mongMin>\\d{1,2})\\s*นาที)?`,
    ].join("|"),
    "g"
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const groups = match.groups ?? {};
    let hour: number | null = null;
    let minute = 0;

    if (groups.clock) {
      const [hStr, mStr] = groups.clock.split(/[:.]/);
      hour = Number(hStr);
      minute = Number(mStr);
    } else if (groups.midnight) {
      hour = 0;
      minute = 0;
    } else if (groups.noon) {
      hour = 12;
      minute = groups.noon.includes("ครึ่ง") ? 30 : 0;
    } else if (groups.tee) {
      const n = parseThaiNumber(groups.tee);
      if (n !== null && n >= 1 && n <= 5) {
        hour = n;
        minute = groups.teeHalf ? 30 : groups.teeMin ? Number(groups.teeMin) : 0;
      }
    } else if (groups.baiMong || groups.baiNum) {
      const n = groups.baiMong ? 1 : parseThaiNumber(groups.baiNum ?? "");
      if (n !== null && n >= 1 && n <= 6) {
        hour = n + 12;
        minute = groups.baiHalf ? 30 : groups.baiMin ? Number(groups.baiMin) : 0;
      }
    } else if (groups.thum) {
      const n = parseThaiNumber(groups.thum);
      if (n !== null && n >= 1 && n <= 5) {
        hour = n + 18;
        minute = groups.thumHalf
          ? 30
          : groups.thumMin
          ? Number(groups.thumMin)
          : 0;
      }
    } else if (groups.mong) {
      const n = parseThaiNumber(groups.mong);
      if (n !== null && n >= 1 && n <= 12) {
        if (groups.mongPeriod === "เย็น") {
          hour = n < 12 ? n + 12 : n;
        } else if (groups.mongPeriod === "เช้า") {
          hour = n;
        } else if (n >= 1 && n <= 5) {
          hour = n + 12; // e.g., 4 โมง -> 16:00
        } else {
          hour = n; // 6..11 โมง -> 06:00..11:00
        }
        minute = groups.mongHalf
          ? 30
          : groups.mongMin
          ? Number(groups.mongMin)
          : 0;
      }
    }

    if (hour !== null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      results.push({
        hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        index: match.index,
        length: match[0].length,
      });
    }
  }

  return results;
}

function cleanTaskTitle(raw: string): string {
  return raw
    .replace(THAI_DAY_REGEX, "")
    .replace(/^(?:แล้ว|จากนั้น|ต่อด้วย|และ|ตอน|เวลา|ช่วง|ใน|ที่|ให้|,\s*|\.\s*)+/g, "")
    .replace(/(?:แล้ว|จากนั้น|ต่อด้วย|และ|ตอน|เวลา|,|\.|;)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseThaiTextDeterministically(
  rawText: string,
  defaultDayOfWeek: DayOfWeek = 1
): Omit<TextToTaskResponse, "used_fallback" | "provider"> {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const lines = normalized
    .split(/\n+|;|\s+และ(?=ช่วย|ตาก|เตรียม)/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentDay: DayOfWeek = defaultDayOfWeek;
  const extracted: TextToTaskExtractedItem[] = [];
  const missingInfoQuestions: string[] = [];

  for (const line of lines) {
    if (/^พรุ่งนี้/.test(line)) currentDay = getThaiDayOfWeek(addDays(getThaiTodayDate(), 1));
    else if (/^วันนี้/.test(line)) currentDay = getThaiDayOfWeek(getThaiTodayDate());
    // Track day mentions inside this line
    const dayMentions: Array<{ index: number; day: DayOfWeek }> = [];
    let dm: RegExpExecArray | null;
    THAI_DAY_REGEX.lastIndex = 0;
    while ((dm = THAI_DAY_REGEX.exec(line)) !== null) {
      dayMentions.push({ index: dm.index, day: mapThaiDayName(dm[1]) });
    }
    if (dayMentions.length > 0 && dayMentions[0].index === 0) {
      currentDay = dayMentions[0].day;
    }

    // Context headers are constraints, never actionable tasks.
    if (/^ขอ.*พัก.*เช้า.*บ่าย/.test(line)) {
      const duration = Number(line.match(/(\d+)\s*นาที/)?.[1] ?? 15);
      for (const [period, time] of [["เช้า", "09:45"], ["บ่าย", "14:15"]]) {
        extracted.push({ temp_id: `txt-${extracted.length + 1}`, day_of_week: currentDay, title: `พักผู้ดูแล (${period})`, description: line, preferred_time: time, duration_minutes: Math.min(720, Math.max(5, duration)), priority: "medium", is_fixed_time: false, is_medically_prescribed: false, assumption_note: "เสนอเวลาเริ่มพัก สามารถปรับได้" });
      }
      continue;
    }
    if (/^(?:พรุ่งนี้|วันนี้)?\s*เริ่มดูแล/.test(line)) {
      continue;
    }
    const timeTokens = findTimeTokens(line);
    const explicitDuration = line.match(/(\d+)\s*(นาที|ชั่วโมง)/);
    const durationFromText = explicitDuration ? Number(explicitDuration[1]) * (explicitDuration[2] === "ชั่วโมง" ? 60 : 1) : undefined;
    if (/ก่อนเที่ยง/.test(line) && timeTokens.length === 1) {
      const duration = durationFromText ?? 40;
      extracted.push({ temp_id: `txt-${extracted.length + 1}`, day_of_week: currentDay, title: cleanTaskTitle(line.split(/\d+\s*(?:นาที|ชั่วโมง)/)[0]).slice(0, 200), description: line, preferred_time: minutesToHhmm(720 - duration), duration_minutes: duration, priority: "high", is_fixed_time: true, is_medically_prescribed: false });
      continue;
    }
    if (/เว้นช่วง|ขอให้เว้น/.test(line) && timeTokens.length === 2) {
      const duration = hhmmToMinutes(timeTokens[1].hhmm) - hhmmToMinutes(timeTokens[0].hhmm);
      if (duration > 0) {
        extracted.push({ temp_id: `txt-${extracted.length + 1}`, day_of_week: currentDay, title: "เว้นช่วงพัก", description: line, preferred_time: timeTokens[0].hhmm, duration_minutes: duration, priority: "high", is_fixed_time: true, is_medically_prescribed: false });
        continue;
      }
    }

    // A time after a task title belongs to that task; do not discard the prefix.
    if (timeTokens.length === 1 && timeTokens[0].index > 0 && !/^(?:วัน|ตอน|ช่วง|เวลา)/.test(line)) {
      const tok = timeTokens[0];
      const title = cleanTaskTitle(line.slice(0, tok.index)).replace(/(?:เวลา|ใช้เวลา)\s*$/, "").trim();
      if (title) {
        const medical = isMedicalTitle(title);
        extracted.push({ temp_id: `txt-${extracted.length + 1}`, day_of_week: currentDay, title: title.slice(0, 200), description: line, preferred_time: tok.hhmm, duration_minutes: Math.min(720, Math.max(5, durationFromText ?? estimateDefaultDuration(title))), priority: medical ? "medical_critical" : "high", is_fixed_time: true, is_medically_prescribed: medical });
        continue;
      }
    }

    if (timeTokens.length === 0) {
      // Split by comma or "แล้ว" when no explicit times exist
      const fragments = line
        .split(/,|แล้ว|จากนั้น/)
        .map((f) => cleanTaskTitle(f))
        .filter((f) => f.length >= 2);

      for (const frag of fragments) {
        const medical = isMedicalTitle(frag);
        const duration = Math.min(720, Math.max(5, durationFromText ?? estimateDefaultDuration(frag)));
        extracted.push({
          temp_id: `txt-${extracted.length + 1}`,
          day_of_week: currentDay,
          title: frag.replace(/\s*\d+\s*(?:นาที|ชั่วโมง).*$/, "").slice(0, 200),
          description: frag,
          preferred_time: null,
          duration_minutes: duration,
          priority: medical ? "medical_critical" : "medium",
          is_fixed_time: medical,
          is_medically_prescribed: medical,
          assumption_note: `ยังไม่ได้ระบุเวลา (ประมาณระยะเวลา ${duration} นาที)`,
          depends_on_temp_id: /หลังซัก/.test(frag) ? [...extracted].reverse().find(task => /ซัก/.test(task.title) && task.day_of_week === currentDay)?.temp_id ?? null : /หลังอาหารเช้า/.test(frag) ? [...extracted].reverse().find(task => /รับประทานอาหาร|กิน.*เช้า/.test(task.title) && task.day_of_week === currentDay)?.temp_id ?? null : null,
        });
        if (medical) missingInfoQuestions.push(`ระบุเวลาตามแพทย์: ${frag.slice(0, 80)}`);
      }
      continue;
    }

    for (let i = 0; i < timeTokens.length; i++) {
      const tok = timeTokens[i];
      // Update currentDay if a day mention appeared before this time token
      for (const dMention of dayMentions) {
        if (dMention.index <= tok.index) {
          currentDay = dMention.day;
        }
      }

      const afterStart = tok.index + tok.length;
      const afterEnd =
        i + 1 < timeTokens.length ? timeTokens[i + 1].index : line.length;
      let rawSegment = line.slice(afterStart, afterEnd);

      // Check if next day mention starts inside rawSegment — trim before it
      const nextDayInSegment = dayMentions.find(
        (d) => d.index >= afterStart && d.index < afterEnd
      );
      if (nextDayInSegment) {
        rawSegment = line.slice(afterStart, nextDayInSegment.index);
      }

      let title = cleanTaskTitle(rawSegment);

      // Fallback: if description came BEFORE the time token (e.g. "เตรียมอาหาร 8 โมง")
      if (!title && i === 0 && tok.index > 0) {
        title = cleanTaskTitle(line.slice(0, tok.index));
      }

      if (!title) continue;

      const medical = isMedicalTitle(title);
      const duration = estimateDefaultDuration(title);

      extracted.push({
        temp_id: `txt-${extracted.length + 1}`,
        day_of_week: currentDay,
        title,
        description: "",
        preferred_time: tok.hhmm,
        duration_minutes: duration,
        priority: medical ? "medical_critical" : "high",
        is_fixed_time: true,
        is_medically_prescribed: medical,
        assumption_note: `แยกจากข้อความภาษาไทย เวลา ${tok.hhmm} น. (ประมาณ ${duration} นาที)`,
      });
    }
  }

  // Fallback if input was short and nothing matched cleanly
  if (extracted.length === 0 && normalized.length > 0 && !/เริ่มดูแล/.test(normalized)) {
    const title = cleanTaskTitle(normalized) || normalized.slice(0, 120);
    const medical = isMedicalTitle(title);
    extracted.push({
      temp_id: "txt-1",
      day_of_week: defaultDayOfWeek,
      title,
      description: "",
      preferred_time: null,
      duration_minutes: estimateDefaultDuration(title),
      priority: medical ? "medical_critical" : "medium",
      is_fixed_time: medical,
      is_medically_prescribed: medical,
      assumption_note: "ยังไม่พบเวลาที่ชัดเจนในข้อความ",
    });
    missingInfoQuestions.push(
      `งาน "${title}" ยังไม่ได้ระบุเวลา กรุณาระบุเวลาที่ต้องการ`
    );
  }

  const windowContext = lines.find(line => /เริ่มดูแล.*ถึง/.test(line));
  for (const task of extracted) {
    if (windowContext) task.description = `${task.description}\n${windowContext}`.trim().slice(0, 1000);
    if (/เตรียมอาหาร/.test(task.title) && !task.preferred_time) {
      const meal = extracted.find(other => other !== task && other.day_of_week === task.day_of_week && /รับประทานอาหาร/.test(other.title) && other.preferred_time && ["เช้า", "กลางวัน", "เย็น"].some(period => task.title.includes(period) && (other.title.includes(period) || (period === "เย็น" && other.preferred_time! >= "16:00") || (period === "เช้า" && other.preferred_time! < "10:00"))));
      if (meal?.preferred_time) {
        let end = hhmmToMinutes(meal.preferred_time);
        const occupied = extracted.filter(other => other !== task && other !== meal && other.day_of_week === task.day_of_week && other.preferred_time && other.is_fixed_time).sort((a, b) => b.preferred_time!.localeCompare(a.preferred_time!));
        for (const other of occupied) {
          const start = hhmmToMinutes(other.preferred_time!);
          if (end - task.duration_minutes < start + other.duration_minutes && end > start) end = start;
        }
        task.preferred_time = minutesToHhmm(end - task.duration_minutes); task.is_fixed_time = true; meal.depends_on_temp_id = task.temp_id;
        task.assumption_note = "เสนอเวลาเตรียมให้เสร็จก่อนมื้ออาหารและไม่ทับกิจกรรมที่ระบุ";
      }
    }
  }
  return {
    raw_text: rawText,
    extracted_tasks: extracted,
    missing_info_questions: missingInfoQuestions,
  };
}

export async function parseTextToTasks(params: {
  text: string;
  default_day_of_week?: DayOfWeek;
  forceFallback?: boolean;
}): Promise<{
  failure_reason?: string;
  response: TextToTaskResponse;
  telemetry: {
    provider: string;
    model: string;
    used_fallback: boolean;
    status: "success" | "fallback" | "error";
    latency_ms: number;
  };
}> {
  const defaultDay: DayOfWeek = params.default_day_of_week ?? 1;
  const deterministic = parseThaiTextDeterministically(params.text, defaultDay);

  const systemInstruction = `คุณคือระบบแยกงานดูแลผู้สูงอายุจากข้อความภาษาไทยที่ผู้ใช้พิมพ์ (CarePlan, โซนเวลา Asia/Bangkok)
กฎเข้มงวด:
1. ตอบกลับเป็น JSON เท่านั้น
2. แปลงคำบอกเวลาภาษาไทยเป็นรูปแบบ 24 ชั่วโมง HH:mm ให้ถูกต้อง เช่น "8 โมง" -> "08:00", "บ่ายสอง" -> "14:00", "2 ทุ่ม" -> "20:00", "ตี 5" -> "05:00", "เที่ยง" -> "12:00", "6 โมงเย็น" -> "18:00"
3. ตรวจจับวันในสัปดาห์ (1=วันจันทร์ ... 7=วันอาทิตย์) หากไม่ระบุให้ใช้ default_day_of_week
4. หากเป็นงานเกี่ยวกับยา การวัดความดัน การฉีดอินซูลิน หรือพาไปหาหมอ ให้ตั้ง is_medically_prescribed = true, is_fixed_time = true, priority = "medical_critical"
5. งานที่ยืดหยุ่นได้ให้ preferred_time = null ไม่ต้องถามเวลาทุกรายการ ถามเฉพาะข้อมูลจำเป็นที่ขาด
6. แยกทุกกิจกรรมเป็นคนละรายการ เช่น ซักผ้าและตากผ้า หรือเตรียมอาหารและช่วยรับประทานอาหาร ใช้ระยะเวลาที่ระบุจริง ไม่ใช้ค่าประมาณถ้าระบุแล้ว
7. เก็บลำดับงานด้วย depends_on_temp_id (รหัสงานก่อนหน้า หรือ null) เช่น อาบน้ำหลังอาหารเช้า ตากผ้าหลังซัก อย่าสร้าง dependency ข้ามวัน
8. ช่วงห้ามจัดงานให้สร้างรายการเวลาคงที่ชื่อ เว้นช่วงพัก พร้อมเวลาเริ่มและระยะเวลาจริง เพื่อกันช่วงนั้นไว้ การพักเช้าและบ่ายให้แยกสองรายการ
9. ประโยคบอกช่วงดูแล เช่น เริ่มดูแล 07:00 ถึง 18:00 เป็นเงื่อนไข ไม่ใช่งาน เก็บเงื่อนไขใน description ของงานที่เกี่ยวข้อง ห้ามสร้างงานชื่อเริ่มดูแล
10. เวลาที่ตามหลังชื่องานเป็นเวลาเริ่มของงานนั้น ไม่ใช่ชื่อของงานถัดไป ชื่องานต้องสั้น ไม่ใส่เงื่อนไขทั้งประโยค
11. วันนี้และพรุ่งนี้อ้างอิง today_day_of_week ไม่ใช่ default_day_of_week; หากคำสั่งมีเงื่อนไขที่ยังจัดแทนไม่ได้ ให้แจ้งสั้นๆ ใน missing_info_questions ห้ามอ้างว่ารองรับแล้ว
12. ใช้ description สั้นไม่เกิน 100 ตัวอักษร เฉพาะเงื่อนไขที่จำเป็น ไม่ต้องคัดลอกข้อความซ้ำ ไม่ต้องส่ง assumption_note`;

  const userPrompt = JSON.stringify({
    text: params.text,
    today_day_of_week: getThaiDayOfWeek(getThaiTodayDate()),
    default_day_of_week: defaultDay,
    required_json_shape: {
      extracted_tasks: [
        {
          temp_id: "txt-1",
          day_of_week: 1,
          title: "ชื่องานภาษาไทยกระชับ",
          description: "",
          preferred_time: null,
          duration_minutes: 30,
          priority: "low | medium | high | medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
        },
      ],
      missing_info_questions: ["string"],
    },
  });

  const geminiRes = await callGeminiJson({
    systemInstruction,
    userPrompt,
    schema: textToTaskGeminiOutputSchema,
    timeoutMs: 25000,
    thinkingLevel: "minimal",
    maxOutputTokens: 8192,
    forceFallback: params.forceFallback,
  });

  if (geminiRes.ok) {
    return {
      response: {
        raw_text: params.text,
        extracted_tasks: geminiRes.data.extracted_tasks.map((item, idx) => {
          const med = item.is_medically_prescribed || isMedicalTitle(item.title);
          const safeDay = Math.min(7, Math.max(1, Math.round(item.day_of_week))) as DayOfWeek;
          return {
            temp_id: item.temp_id || `txt-${idx + 1}`,
            day_of_week: safeDay,
            title: item.title,
            description: [item.description ?? "", params.text.split(/\r?\n/).find(line => /เริ่มดูแล.*ถึง/.test(line)) ?? ""].filter(Boolean).join("\n").slice(0, 1000),
            preferred_time: item.preferred_time,
            duration_minutes: item.duration_minutes ?? estimateDefaultDuration(item.title),
            priority: med ? "medical_critical" : (item.priority ?? "medium"),
            is_fixed_time: med || Boolean(item.is_fixed_time),
            is_medically_prescribed: med,
            assumption_note: item.assumption_note ?? undefined,
            depends_on_temp_id: item.depends_on_temp_id && geminiRes.data.extracted_tasks.some(parent => parent.temp_id === item.depends_on_temp_id && parent.temp_id !== item.temp_id && parent.day_of_week === item.day_of_week) ? item.depends_on_temp_id : null,
          };
        }),
        missing_info_questions: geminiRes.data.missing_info_questions ?? [],
        used_fallback: false,
        provider: `gemini:${geminiRes.model}`,
      },
      telemetry: {
        provider: "gemini",
        model: geminiRes.model,
        used_fallback: false,
        status: "success",
        latency_ms: geminiRes.latencyMs,
      },
    };
  }

  return {
    failure_reason: geminiRes.ok ? "ai_output_validation_failed" : geminiRes.reason,
    response: {
      ...deterministic,
      used_fallback: true,
      provider: "deterministic_fallback",
    },
    telemetry: {
      provider: "deterministic_fallback",
      model: geminiRes.model,
      used_fallback: true,
      status: "fallback",
      latency_ms: geminiRes.latencyMs,
    },
  };
}

// =============================================================================
// AI PROCESS 2: Empathetic Daily Summary (Reads Verified DB Data Only)
// =============================================================================

export function classifySummaryTone(
  metrics: DailySummaryMetrics,
  isRestDay: boolean
): DailySummaryRecord["tone_category"] {
  if (isRestDay) {
    return "rest_day";
  }
  if (metrics.total_tasks === 0) {
    return "on_time_praise";
  }
  if (
    metrics.completed_tasks === metrics.total_tasks &&
    metrics.delayed_completions === 0
  ) {
    return "on_time_praise";
  }
  if (
    metrics.completed_tasks > 0 &&
    metrics.delayed_completions > 0 &&
    metrics.incomplete_tasks <= metrics.completed_tasks
  ) {
    return "delayed_empathy";
  }
  if (metrics.incomplete_tasks > 0) {
    return "incomplete_support";
  }
  return "delayed_empathy";
}

function buildDeterministicSummaryMessage(
  metrics: DailySummaryMetrics,
  tone: DailySummaryRecord["tone_category"],
  caregiverName: string
): string {
  switch (tone) {
    case "rest_day":
      return `วันนี้เป็นวันพักผ่อนของ${caregiverName} ขอให้ได้พักฟื้นทั้งกายและใจอย่างเต็มที่นะ การดูแลตัวเองให้แข็งแรงคือพลังสำคัญในการดูแลคนที่คุณรักในวันต่อไป (หมายเหตุ: ยาหรือการดูแลทางการแพทย์ที่จำเป็นยังคงต้องดูแลตามคำสั่งแพทย์)`;
    case "on_time_praise":
      if (metrics.total_tasks === 0) {
        return `วันนี้ยังไม่มีรายการงานในตาราง ${caregiverName}สามารถใช้เวลาพักผ่อนหรือวางแผนดูแลเพิ่มเติมได้ตามความสะดวกเลยนะ`;
      }
      return `วันนี้คุณจัดการงานได้ดีมากเลยนะ เก่งมาก! ทำครบ ${metrics.completed_tasks}/${metrics.total_tasks} รายการตรงเวลา (${metrics.progress_percent}%) อย่าลืมพักผ่อนให้ตัวเองด้วย`;
    case "delayed_empathy":
      return `วันนี้อาจมีบางอย่างไม่เป็นไปตามแผน (เสร็จแล้ว ${metrics.completed_tasks}/${metrics.total_tasks} รายการ ล่าช้า ${metrics.delayed_completions} รายการ) แต่คุณก็พยายามอย่างเต็มที่แล้ว พักผ่อนให้เพียงพอนะ`;
    case "incomplete_support":
      return `วันนี้คงมีหลายอย่างให้จัดการ (เสร็จแล้ว ${metrics.completed_tasks}/${metrics.total_tasks} รายการ และยังเหลือ ${metrics.incomplete_tasks} รายการ) ไม่เป็นไรนะ ค่อย ๆ ทำทีละอย่าง และอย่าลืมขอความช่วยเหลือจากครอบครัวหากจำเป็น`;
  }
}

export async function buildDailySummary(params: {
  date: string;
  metrics: DailySummaryMetrics;
  isRestDay: boolean;
  caregiverName: string;
  careRecipientName: string;
  forceFallback?: boolean;
}): Promise<{
  failure_reason?: string;
  summaryInput: Omit<DailySummaryRecord, "id" | "user_id" | "generated_at">;
  telemetry: {
    provider: string;
    model: string;
    used_fallback: boolean;
    status: "success" | "fallback" | "error";
    latency_ms: number;
  };
}> {
  const tone = classifySummaryTone(params.metrics, params.isRestDay);
  const fallbackMessage = buildDeterministicSummaryMessage(
    params.metrics,
    tone,
    params.caregiverName
  );

  const systemInstruction = `คุณคือผู้ช่วยส่งกำลังใจให้ผู้ดูแลผู้สูงอายุที่บ้าน (CarePlan ภาษาไทย)
กฎเข้มงวด:
1. ใช้เฉพาะตัวเลขจาก verified_metrics ที่ส่งให้เท่านั้น ห้ามแต่งตัวเลขหรือข้อมูลใหม่เด็ดขาด
2. ห้ามตำหนิ วิจารณ์ ทำให้รู้สึกผิด หรือกดดันผู้ดูแลเด็ดขาด
3. ปรับโทนข้อความตาม tone_category:
   - on_time_praise: ชื่นชมความตั้งใจและความตรงเวลาอย่างอบอุ่น
   - delayed_empathy: ให้กำลังใจอย่างเข้าใจโดยไม่ตำหนิเรื่องความล่าช้า
   - incomplete_support: แสดงความเห็นอกเห็นใจอย่างลึกซึ้ง และแนะนำอย่างนุ่มนวลว่าสามารถขอความช่วยเหลือจากครอบครัวหรือคนใกล้ชิดได้
   - rest_day: ชื่นชมการพักผ่อนและดูแลสุขภาพใจของตนเอง
4. เขียนภาษาไทยธรรมชาติ อบอุ่น กระชับ ความยาว 2-4 ประโยค และตอบเป็น JSON {"encouraging_message": "..."}`;

  const userPrompt = JSON.stringify({
    date: params.date,
    caregiver_name: params.caregiverName,
    care_recipient_name: params.careRecipientName,
    is_rest_day: params.isRestDay,
    tone_category: tone,
    verified_metrics: params.metrics,
  });

  const geminiRes = await callGeminiJson({
    systemInstruction,
    userPrompt,
    schema: dailySummaryGeminiOutputSchema,
    forceFallback: params.forceFallback,
  });

  if (geminiRes.ok) {
    return {
      summaryInput: {
        summary_date: params.date,
        metrics: params.metrics,
        encouraging_message: geminiRes.data.encouraging_message.trim(),
        tone_category: tone,
        ai_provider: `gemini:${geminiRes.model}`,
        used_fallback: false,
      },
      telemetry: {
        provider: "gemini",
        model: geminiRes.model,
        used_fallback: false,
        status: "success",
        latency_ms: geminiRes.latencyMs,
      },
    };
  }

  return {
    failure_reason: geminiRes.ok ? "ai_output_validation_failed" : geminiRes.reason,
    summaryInput: {
      summary_date: params.date,
      metrics: params.metrics,
      encouraging_message: fallbackMessage,
      tone_category: tone,
      ai_provider: "deterministic_fallback",
      used_fallback: true,
    },
    telemetry: {
      provider: "deterministic_fallback",
      model: geminiRes.model,
      used_fallback: true,
      status: "fallback",
      latency_ms: geminiRes.latencyMs,
    },
  };
}

// =============================================================================
// FEATURE 9: Schedule-Aware Optional Rest Suggestions
// =============================================================================

export interface ScheduleGap {
  gap_start: string;
  gap_end: string;
  duration_minutes: number;
}

export function findScheduleGaps(occurrences: DailyTaskOccurrence[]): ScheduleGap[] {
  const DAY_START = 7 * 60; // 07:00
  const DAY_END = 21 * 60; // 21:00
  const MIN_GAP = 5;

  if (occurrences.length === 0) {
    return [
      { gap_start: "10:00", gap_end: "10:30", duration_minutes: 30 },
      { gap_start: "15:00", gap_end: "16:00", duration_minutes: 60 },
    ];
  }

  const intervals = occurrences
    .map((o) => {
      const start = hhmmToMinutes(o.scheduled_time);
      const end = Math.min(23 * 60 + 59, start + o.duration_minutes);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  // Merge overlapping intervals
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (!last || iv.start > last.end) {
      merged.push({ ...iv });
    } else {
      last.end = Math.max(last.end, iv.end);
    }
  }

  const gaps: ScheduleGap[] = [];
  let cursor = DAY_START;

  for (const iv of merged) {
    const clippedStart = Math.max(DAY_START, iv.start);
    if (clippedStart - cursor >= MIN_GAP) {
      const gapDuration = clippedStart - cursor;
      // Between tasks: allow 5+ min micro-breaks; before first task: require >= 15 min
      if (cursor > DAY_START || gapDuration >= 15) {
        gaps.push({
          gap_start: minutesToHhmm(cursor),
          gap_end: minutesToHhmm(clippedStart),
          duration_minutes: gapDuration,
        });
      }
    }
    cursor = Math.max(cursor, Math.min(DAY_END, iv.end));
  }

  if (DAY_END - cursor >= 15) {
    gaps.push({
      gap_start: minutesToHhmm(cursor),
      gap_end: minutesToHhmm(Math.min(DAY_END, cursor + 60)),
      duration_minutes: Math.min(60, DAY_END - cursor),
    });
  }

  return gaps.slice(0, 4);
}

function buildDeterministicRestSuggestions(
  date: string,
  gaps: ScheduleGap[],
  requiresSupervision: boolean
): Array<
  Omit<RestSuggestionRecord, "id" | "user_id" | "created_at" | "updated_at">
> {
  const safetyNote = requiresSupervision
    ? DEFAULT_SUPERVISION_SAFETY_NOTE
    : "สามารถพักผ่อนตามอัธยาศัยในบริเวณที่ยังคงดูแลและได้ยินเสียงผู้สูงอายุได้สะดวก";

  // 5–14 minutes: micro-break
  const microActivities = [
    {
      title: "พักสายตา หายใจเข้าออกลึกๆ และดื่มน้ำ (5-10 นาที)",
      desc: "วางโทรศัพท์สักครู่ ลุกขึ้นดื่มน้ำสะอาดและพักสายตาใกล้ห้องดูแลเพื่อคลายความล้าทันที",
    },
    {
      title: "ฟังเพลงบรรเลงสั้นๆ เพื่อผ่อนคลาย (5-10 นาที)",
      desc: "เปิดเพลงเบาๆ ด้วยลำโพง (ไม่ใส่หูฟังตัดเสียง) เพื่อพักสมองระหว่างช่วงงาน",
    },
  ];

  // 15–29 minutes: medium break
  const mediumActivities = [
    {
      title: "อ่านหนังสือหรือยืดเหยียดคอ บ่า ไหล่ (15-30 นาที)",
      desc: "ยืดกล้ามเนื้อที่เมื่อยล้าจากการดูแล หรืออ่านหนังสือเล่มโปรดในบริเวณที่ดูแลได้สะดวก",
    },
    {
      title: "จิบเครื่องดื่มอุ่นๆ และพักผ่อนสั้นๆ (15-30 นาที)",
      desc: "นั่งพักหายใจสบายๆ พร้อมเครื่องดื่มอุ่นๆ เพื่อให้ร่างกายได้ฟื้นตัวระหว่างวัน",
    },
  ];

  // 30+ minutes: longer recharge
  const longActivities = [
    {
      title: "ทำงานอดิเรกเบาๆ หรือเดินผ่อนคลาย (30-60 นาที)",
      desc: "ใช้เวลาว่างทำงานอดิเรกที่ชอบ อ่านหนังสือ หรือเดินผ่อนคลายใกล้บ้านเมื่อมีสมาชิกช่วยดูแลแทน",
    },
    {
      title: "พักงีบหรือผ่อนคลายเต็มที่ใกล้ห้องดูแล (30-60 นาที)",
      desc: "พักผ่อนเติมพลังในพื้นที่ที่ยังได้ยินเสียงผู้สูงอายุได้ชัดเจน หรือสลับให้สมาชิกในครอบครัวช่วยดูแลชั่วคราว",
    },
  ];

  return gaps.map((gap, idx) => {
    const pool =
      gap.duration_minutes < 15
        ? microActivities
        : gap.duration_minutes < 30
        ? mediumActivities
        : longActivities;
    const chosen = pool[idx % pool.length];

    return {
      suggestion_date: date,
      gap_start: gap.gap_start,
      gap_end: gap.gap_end,
      duration_minutes: gap.duration_minutes,
      activity_title: chosen.title,
      description: chosen.desc,
      supervision_safety_note: safetyNote,
      status: "suggested",
    };
  });
}

export async function buildRestSuggestions(params: {
  date: string;
  occurrences: DailyTaskOccurrence[];
  careRecipient: Pick<
    CareRecipientProfile,
    "display_name" | "mobility_level" | "requires_supervision"
  >;
  forceFallback?: boolean;
}): Promise<{
  failure_reason?: string;
  suggestions: Array<
    Omit<RestSuggestionRecord, "id" | "user_id" | "created_at" | "updated_at">
  >;
  telemetry: {
    provider: string;
    model: string;
    used_fallback: boolean;
    status: "success" | "fallback" | "error";
    latency_ms: number;
  };
}> {
  const gaps = findScheduleGaps(params.occurrences);
  const deterministic = buildDeterministicRestSuggestions(
    params.date,
    gaps,
    params.careRecipient.requires_supervision
  );

  if (gaps.length === 0) {
    return {
      failure_reason: "no_available_gaps",
      suggestions: [],
      telemetry: {
        provider: "deterministic_fallback",
        model: "none",
        used_fallback: true,
        status: "fallback",
        latency_ms: 0,
      },
    };
  }

  const systemInstruction = `คุณคือผู้ช่วยแนะนำเวลาพักผ่อนแบบไม่บังคับสำหรับผู้ดูแลผู้สูงอายุที่บ้าน (CarePlan ภาษาไทย)
กฎความปลอดภัยเข้มงวด:
1. ห้ามแนะนำให้ผู้ดูแลทิ้งผู้สูงอายุที่ต้องการการดูแลไว้ตามลำพังเด็ดขาด!
2. แนะนำกิจกรรมพักผ่อนที่เหมาะกับช่วงเวลาว่างที่ให้มา เช่น ฟังเพลง อ่านหนังสือ ยืดเหยียด จิบชาอุ่นๆ พักสายตาจากหน้าจอ ทำงานอดิเรกเบาๆ หรือเดินผ่อนคลายใกล้บ้านเฉพาะเมื่อมีผู้ช่วยเฝ้าดูแลแทน
3. ทุกคำแนะนำต้องมี supervision_safety_note ที่ย้ำความปลอดภัยของผู้สูงอายุเสมอ
4. ตอบเป็น JSON เท่านั้น`;

  const userPrompt = JSON.stringify({
    date: params.date,
    care_recipient_requires_supervision:
      params.careRecipient.requires_supervision,
    mobility_level: params.careRecipient.mobility_level,
    available_gaps: gaps,
    required_json_shape: {
      suggestions: [
        {
          gap_start: "HH:mm",
          gap_end: "HH:mm",
          duration_minutes: 45,
          activity_title: "ชื่อกิจกรรมพักผ่อนภาษาไทย",
          description: "คำอธิบายสั้นๆ อบอุ่น",
          supervision_safety_note: "ข้อควรระวังเรื่องการไม่ปล่อยผู้สูงอายุตามลำพัง",
        },
      ],
    },
  });

  const geminiRes = await callGeminiJson({
    systemInstruction,
    userPrompt,
    schema: restSuggestionsGeminiOutputSchema,
    timeoutMs: 25000,
    forceFallback: params.forceFallback,
  });

  const validRestOutput = geminiRes.ok && geminiRes.data.suggestions.length > 0 && (() => {
    const intervals = geminiRes.data.suggestions.map(item => ({ start: hhmmToMinutes(item.gap_start), end: hhmmToMinutes(item.gap_end), duration: item.duration_minutes })).sort((a,b) => a.start-b.start);
    if (params.careRecipient.requires_supervision && geminiRes.data.suggestions.some(item => /ออกจากบ้าน|นอกบ้าน|ไปเที่ยว|เดินห้าง|ปล่อย.{0,30}(?:ลำพัง|คนเดียว)|ทิ้ง.{0,30}(?:ลำพัง|คนเดียว)/.test(item.activity_title + " " + item.description))) return false;
    return intervals.every((item,index) => item.end > item.start && item.end-item.start === item.duration &&
      gaps.some(gap => item.start >= hhmmToMinutes(gap.gap_start) && item.end <= hhmmToMinutes(gap.gap_end)) &&
      (!index || item.start >= intervals[index-1].end));
  })();
  if (geminiRes.ok && validRestOutput) {
    const safeSuggestions = geminiRes.data.suggestions.map((s) => ({
      suggestion_date: params.date,
      gap_start: s.gap_start,
      gap_end: s.gap_end,
      duration_minutes: s.duration_minutes,
      activity_title: s.activity_title.trim(),
      description: s.description.trim(),
      supervision_safety_note: params.careRecipient.requires_supervision
        ? DEFAULT_SUPERVISION_SAFETY_NOTE
        : s.supervision_safety_note.trim().length >= 15 ? s.supervision_safety_note.trim() : DEFAULT_SUPERVISION_SAFETY_NOTE,
      status: "suggested" as const,
    }));

    return {
      suggestions: safeSuggestions,
      telemetry: {
        provider: "gemini",
        model: geminiRes.model,
        used_fallback: false,
        status: "success",
        latency_ms: geminiRes.latencyMs,
      },
    };
  }

  return {
    failure_reason: geminiRes.ok ? "ai_output_validation_failed" : geminiRes.reason,
    suggestions: deterministic,
    telemetry: {
      provider: "deterministic_fallback",
      model: geminiRes.model,
      used_fallback: true,
      status: "fallback",
      latency_ms: geminiRes.latencyMs,
    },
  };
}
