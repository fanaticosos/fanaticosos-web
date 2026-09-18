import { json } from "../../lib/http.js";
import { isParticipationSlotPast } from "../../lib/participation.js";

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "configuration_unavailable" }, 503);
  const result = await env.DB.prepare("SELECT id, status FROM participation_slots ORDER BY stream_date").all();
  return json({
    slots: (result.results ?? []).map((slot) => ({
      ...slot,
      status: isParticipationSlotPast(slot.id) ? "past" : slot.status,
    })),
  });
}
