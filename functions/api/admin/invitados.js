import { requireAdministrator } from "../../lib/access.js";
import { json } from "../../lib/http.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.PARTICIPATION_ADMIN_EMAIL) return json({ error: "configuration_unavailable" }, 503);
  if (!await requireAdministrator(request, env)) return json({ error: "unauthorized" }, 401);
  const result = await env.DB.prepare(`SELECT
    r.id, r.slot_id AS slotId, r.status, r.full_name AS fullName, r.email, r.phone,
    r.birth_date AS birthDate, r.bears_story AS bearsStory, r.song_title AS songTitle,
    r.song_artist AS songArtist, r.song_reason AS songReason, r.email_status AS emailStatus,
    r.decision_email_status AS decisionEmailStatus, r.submitted_at AS submittedAt,
    s.stream_date AS streamDate, s.previous_game AS previousGame, s.next_game AS nextGame,
    s.special_topic AS specialTopic
    FROM participation_requests r
    JOIN participation_slots s ON s.id = r.slot_id
    ORDER BY s.stream_date, r.submitted_at`).all();
  const slots = await env.DB.prepare(`SELECT
    s.id, s.stream_date AS streamDate, s.status, s.previous_game AS previousGame,
    s.next_game AS nextGame, COUNT(r.id) AS requestCount,
    GROUP_CONCAT(r.full_name, '|||') AS requestNames
    FROM participation_slots s
    LEFT JOIN participation_requests r ON r.slot_id = s.id
    GROUP BY s.id
    ORDER BY s.stream_date`).all();
  return json({ requests: result.results ?? [], slots: slots.results ?? [] });
}
