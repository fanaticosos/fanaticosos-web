import { requireAdministrator } from "../../../lib/access.js";
import { json, sameOrigin } from "../../../lib/http.js";
import { sendDecisionEmail } from "../../../lib/participation.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (!env.DB || !env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL || !env.PARTICIPATION_ADMIN_EMAIL) return json({ error: "configuration_unavailable" }, 503);
  if (!await requireAdministrator(request, env)) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body?.requestId || !["confirm", "reject"].includes(body.action)) return json({ error: "invalid_action" }, 400);

  const item = await env.DB.prepare(`SELECT r.*, s.stream_date, s.previous_game, s.next_game, s.special_topic, s.status AS slot_status
    FROM participation_requests r JOIN participation_slots s ON s.id = r.slot_id WHERE r.id = ?`)
    .bind(body.requestId).first();
  if (!item) return json({ error: "request_not_found" }, 404);
  if (!["pending", "waitlisted"].includes(item.status)) return json({ error: "request_already_decided" }, 409);
  const now = new Date().toISOString();

  if (body.action === "confirm") {
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE participation_requests SET status = 'confirmed', updated_at = ?
        WHERE id = ? AND status IN ('pending','waitlisted')
        AND NOT EXISTS (SELECT 1 FROM participation_requests WHERE slot_id = ? AND status = 'confirmed')`)
        .bind(now, item.id, item.slot_id),
      env.DB.prepare(`UPDATE participation_slots SET status = 'confirmed', confirmed_request_id = ?, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM participation_requests WHERE id = ? AND status = 'confirmed')`)
        .bind(item.id, now, item.slot_id, item.id),
      env.DB.prepare(`UPDATE participation_requests SET status = 'waitlisted', updated_at = ?
        WHERE slot_id = ? AND id <> ? AND status = 'pending'`)
        .bind(now, item.slot_id, item.id),
    ]);
    if (!results[0]?.meta?.changes) return json({ error: "slot_already_confirmed" }, 409);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE participation_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND status IN ('pending','waitlisted')").bind(now, item.id),
      env.DB.prepare(`UPDATE participation_requests SET status = 'pending', updated_at = ? WHERE id = (
        SELECT id FROM participation_requests WHERE slot_id = ? AND status = 'waitlisted' ORDER BY submitted_at LIMIT 1
      )`).bind(now, item.slot_id),
      env.DB.prepare(`UPDATE participation_slots SET status = CASE
        WHEN EXISTS (SELECT 1 FROM participation_requests WHERE slot_id = ? AND status IN ('pending','waitlisted')) THEN 'pending'
        ELSE 'available' END, updated_at = ? WHERE id = ?`).bind(item.slot_id, now, item.slot_id),
    ]);
  }

  let emailStatus = "sent";
  let emailId = null;
  try {
    emailId = await sendDecisionEmail({ env, request: item, slot: item, decision: body.action });
  } catch {
    emailStatus = "failed";
  }
  await env.DB.prepare("UPDATE participation_requests SET decision_email_status = ?, decision_email_id = ?, updated_at = ? WHERE id = ?")
    .bind(emailStatus, emailId, new Date().toISOString(), item.id).run();
  return json({ updated: true, status: body.action === "confirm" ? "confirmed" : "rejected", emailStatus });
}
