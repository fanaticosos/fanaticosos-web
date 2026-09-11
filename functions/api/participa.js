import { json, sameOrigin } from "../lib/http.js";
import {
  sendParticipationEmails,
  validateParticipationForm,
  verifyTurnstile,
} from "../lib/participation.js";

const requiredConfiguration = [
  "DB",
  "TURNSTILE_SECRET_KEY",
  "BREVO_API_KEY",
  "BREVO_FROM_EMAIL",
  "PARTICIPATION_ADMIN_EMAIL",
];

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (requiredConfiguration.some((name) => !env[name])) return json({ error: "configuration_unavailable" }, 503);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 50_000) return json({ error: "request_too_large" }, 413);

  let form;
  let submission;
  try {
    form = await request.formData();
    if (String(form.get("website") ?? "")) return json({ accepted: true }, 202);
    submission = validateParticipationForm(form);
  } catch (error) {
    return json({ error: error.message?.startsWith("invalid:") ? error.message : "invalid_form" }, 400);
  }

  const turnstileValid = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY,
    token: String(form.get("cf-turnstile-response") ?? ""),
    remoteIp: request.headers.get("cf-connecting-ip"),
  });
  if (!turnstileValid) return json({ error: "turnstile_failed" }, 400);

  const slot = await env.DB.prepare(
    "SELECT id, stream_date, previous_game, next_game, special_topic, status FROM participation_slots WHERE id = ?",
  ).bind(submission.slotId).first();
  if (!slot) return json({ error: "slot_not_found" }, 404);
  if (slot.status === "confirmed") return json({ error: "slot_unavailable" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO participation_requests (
        id, slot_id, status, full_name, email, phone, birth_date, bears_story,
        song_title, song_artist, song_reason, rules_accepted_at, privacy_accepted_at,
        publication_accepted_at, request_acknowledged_at, submitted_at, updated_at
      ) SELECT ?, id, CASE WHEN status = 'available' THEN 'pending' ELSE 'waitlisted' END,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM participation_slots WHERE id = ?`)
        .bind(id, submission.fullName, submission.email, submission.phone,
          submission.birthDate, submission.bearsStory, submission.songTitle, submission.songArtist,
          submission.songReason, now, now, now, now, now, now, submission.slotId),
      env.DB.prepare("UPDATE participation_slots SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'available'")
        .bind(now, submission.slotId),
    ]);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return json({ error: "duplicate_request" }, 409);
    throw error;
  }

  const storedRequest = await env.DB.prepare("SELECT status FROM participation_requests WHERE id = ?").bind(id).first();
  if (!storedRequest) return json({ error: "request_not_saved" }, 500);
  const requestStatus = storedRequest.status;

  const email = await sendParticipationEmails({ env, request: submission, slot, requestId: id });
  await env.DB.prepare(`UPDATE participation_requests
    SET email_status = ?, participant_email_id = ?, admin_email_id = ?, updated_at = ? WHERE id = ?`)
    .bind(email.status, email.participantId, email.adminId, new Date().toISOString(), id).run();

  return json({
    accepted: true,
    requestId: id,
    status: requestStatus,
    emailStatus: email.status,
  }, 201);
}

export function onRequest() {
  return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
}
