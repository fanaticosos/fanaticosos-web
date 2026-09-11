import { z } from "astro/zod";

export const participationSlotsSchema = z.object({
  version: z.literal(1),
  season: z.number().int(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.literal("America/Mexico_City"),
  source: z.string().min(1),
  slots: z.array(z.object({
    id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["available", "pending", "confirmed"]),
    previousGame: z.string().min(1),
    nextGame: z.string().min(1),
    specialTopic: z.string().min(1).nullable(),
  })).min(1),
}).superRefine((value, context) => {
  if (new Set(value.slots.map((slot) => slot.id)).size !== value.slots.length) {
    context.addIssue({ code: "custom", path: ["slots"], message: "Slot IDs must be unique" });
  }
  for (const [index, slot] of value.slots.entries()) {
    if (slot.id !== slot.date) context.addIssue({ code: "custom", path: ["slots", index], message: "Slot ID must match its date" });
    if (new Date(`${slot.date}T12:00:00Z`).getUTCDay() !== 3) context.addIssue({ code: "custom", path: ["slots", index, "date"], message: "Streams must be on Wednesday" });
  }
});
