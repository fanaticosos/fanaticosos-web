import { requireAdministrator } from "../../../lib/access.js";
import { json, sameOrigin } from "../../../lib/http.js";
import {
  isParticipationSlotPast,
  sendDecisionEmail,
  validateAdministrativeReservation,
} from "../../../lib/participation.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (!env.DB || !env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL || !env.PARTICIPATION_ADMIN_EMAIL) {
    return json({ error: "configuration_unavailable" }, 503);
  }
  if (!await requireAdministrator(request, env)) return json({ error: "unauthorized" }, 401);

  let reservation;
  try {
    reservation = validateAdministrativeReservation(await request.json());
  } catch (error) {
    return json({ error: error.message?.startsWith("invalid:") ? error.message : "invalid_json" }, 400);
  }

  const slot = await env.DB.prepare(`SELECT id, stream_date, previous_game, next_game, special_topic, status
    FROM participation_slots WHERE id = ?`).bind(reservation.slotId).first();
  if (!slot) return json({ error: "slot_not_found" }, 404);
  if (isParticipationSlotPast(slot.stream_date)) return json({ error: "slot_past" }, 409);
  if (slot.status !== "available") return json({ error: "slot_unavailable" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO participation_requests (
      id, slot_id, status, full_name, email, phone, birth_date, bears_story,
      song_title, song_artist, song_reason, rules_accepted_at, privacy_accepted_at,
      publication_accepted_at, request_acknowledged_at, email_status, submitted_at, updated_at
    ) SELECT ?, id, 'confirmed', ?, ?, '', '1900-01-01', '__admin_reservation__',
      '', '', '', ?, ?, ?, ?, 'pending', ?, ?
      FROM participation_slots WHERE id = ? AND status = 'available'`)
      .bind(id, reservation.fullName, reservation.email, now, now, now, now, now, now, reservation.slotId),
    env.DB.prepare(`UPDATE participation_slots SET status = 'confirmed', confirmed_request_id = ?, updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM participation_requests WHERE id = ? AND status = 'confirmed')`)
      .bind(id, now, reservation.slotId, id),
  ]);
  if (!results[0]?.meta?.changes || !results[1]?.meta?.changes) return json({ error: "slot_unavailable" }, 409);

  const stored = { email: reservation.email, full_name: reservation.fullName };
  let emailStatus = "sent";
  let emailId = null;
  try {
    emailId = await sendDecisionEmail({ env, request: stored, slot, decision: "confirm" });
  } catch {
    emailStatus = "failed";
  }
  await env.DB.prepare(`UPDATE participation_requests
    SET email_status = ?, decision_email_status = ?, decision_email_id = ?, updated_at = ? WHERE id = ?`)
    .bind(emailStatus, emailStatus, emailId, new Date().toISOString(), id).run();

  return json({ created: true, requestId: id, emailStatus }, 201);
}
