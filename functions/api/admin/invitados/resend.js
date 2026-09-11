import { requireAdministrator } from "../../../lib/access.js";
import { json } from "../../../lib/http.js";
import { sendParticipationEmails } from "../../../lib/participation.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL || !env.PARTICIPATION_ADMIN_EMAIL) return json({ error: "configuration_unavailable" }, 503);
  if (!await requireAdministrator(request, env)) return json({ error: "unauthorized" }, 401);
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return json({ error: "invalid_request" }, 400);

  const item = await env.DB.prepare(`SELECT r.*, s.stream_date, s.previous_game, s.next_game, s.special_topic
    FROM participation_requests r JOIN participation_slots s ON s.id = r.slot_id WHERE r.id = ?`).bind(id).first();
  if (!item) return json({ error: "not_found" }, 404);
  const email = await sendParticipationEmails({
    env,
    request: { fullName: item.full_name, email: item.email, phone: item.phone, birthDate: item.birth_date,
      bearsStory: item.bears_story, songTitle: item.song_title, songArtist: item.song_artist, songReason: item.song_reason },
    slot: item,
    requestId: item.id,
  });
  await env.DB.prepare(`UPDATE participation_requests SET email_status = ?, participant_email_id = ?,
    admin_email_id = ?, updated_at = ? WHERE id = ?`)
    .bind(email.status, email.participantId, email.adminId, new Date().toISOString(), item.id).run();
  return json({ ok: email.status !== "failed", emailStatus: email.status }, email.status === "failed" ? 502 : 200);
}
