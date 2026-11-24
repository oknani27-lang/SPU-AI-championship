import { z } from "zod";
import type { DayOfWeek } from "@/types/careplan";

export const dayOfWeekSchema = z
  .number()
  .int()
  .min(1)
  .max(7)
  .transform((v) => v as DayOfWeek);

export const taskPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "medical_critical",
]);

export const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "เวลาต้องอยู่ในรูปแบบ HH:mm");

export const draftTaskInputSchema = z.object({
  temp_id: z.string().min(1),
  title: z.string().min(1, "ชื่องานต้องไม่ว่างเปล่า").max(200),
  description: z.string().max(1000).optional(),
  preferred_time: hhmmSchema.optional().or(z.literal("")),
  duration_minutes: z.number().int().min(5).max(720).optional(),
  priority: taskPrioritySchema.optional(),
  is_fixed_time: z.boolean().optional(),
  is_medically_prescribed: z.boolean().optional(),
  depends_on_temp_id: z.string().nullable().optional(),
});

export const proposedScheduleTaskSchema = z.object({
  temp_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  scheduled_time: hhmmSchema,
  duration_minutes: z.number().int().min(5).max(720),
  priority: taskPrioritySchema,
  is_fixed_time: z.boolean(),
  is_medically_prescribed: z.boolean(),
  depends_on_temp_id: z.string().nullable().default(null),
  rationale: z.string().min(1).max(400),
});

export const aiScheduleGeminiOutputSchema = z.object({
  proposed_tasks: z.array(proposedScheduleTaskSchema).min(1),
  assumptions: z.array(z.string()).default([]),
  missing_info_questions: z.array(z.string()).default([]),
  summary_note: z.string().min(1).max(500),
});

export const textToTaskExtractedItemSchema = z.object({
  temp_id: z.string().min(1),
  day_of_week: dayOfWeekSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  preferred_time: hhmmSchema.nullable(),
  duration_minutes: z.number().int().min(5).max(720).default(30),
  priority: taskPrioritySchema.default("medium"),
  is_fixed_time: z.boolean().default(false),
  is_medically_prescribed: z.boolean().default(false),
  assumption_note: z.string().max(300).nullish().transform(value => value ?? undefined),
  depends_on_temp_id: z.string().nullable().optional(),
});

export const textToTaskGeminiOutputSchema = z.object({
  extracted_tasks: z.array(textToTaskExtractedItemSchema).min(1),
  missing_info_questions: z.array(z.string()).default([]),
}).superRefine((value, ctx) => {
  const byId = new Map(value.extracted_tasks.map(task => [task.temp_id, task]));
  if (byId.size !== value.extracted_tasks.length) ctx.addIssue({ code: "custom", message: "Duplicate task IDs" });
  for (const task of value.extracted_tasks) {
    const seen = new Set([task.temp_id]);
    let parentId = task.depends_on_temp_id;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent || seen.has(parentId) || parent.day_of_week !== task.day_of_week) {
        ctx.addIssue({ code: "custom", message: "Invalid task dependency" }); break;
      }
      seen.add(parentId); parentId = parent.depends_on_temp_id;
    }
  }
});

export const dailySummaryGeminiOutputSchema = z.object({
  encouraging_message: z.string().min(10).max(800),
});

export const restSuggestionGeminiItemSchema = z.object({
  gap_start: hhmmSchema,
  gap_end: hhmmSchema,
  duration_minutes: z.number().int().min(20),
  activity_title: z.string().min(2).max(160),
  description: z.string().min(5).max(400),
  supervision_safety_note: z.string().min(10).max(400),
});

export const restSuggestionsGeminiOutputSchema = z.object({
  suggestions: z.array(restSuggestionGeminiItemSchema),
});
