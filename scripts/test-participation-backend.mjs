import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  escapeHtml,
  sendParticipationEmails,
  validateParticipationForm,
  verifyTurnstile,
} from "../functions/lib/participation.js";

const migration = await readFile(new URL("../migrations/0001_participation.sql", import.meta.url), "utf8");
const database = new DatabaseSync(":memory:");
database.exec(migration);
assert.equal(database.prepare("SELECT COUNT(*) AS count FROM participation_slots").get().count, 16);
assert.equal(database.prepare("SELECT special_topic FROM participation_slots WHERE id = ?").get("2026-11-11").special_topic, "Evaluación de media temporada, objetivos y desempeño");
database.close();

const validForm = new FormData();
for (const [name, value] of Object.entries({
  streamSlot: "2026-11-11", fullName: "Ana Ejemplo", email: "ANA@example.com", phone: "+52 55 1234 5678",
  birthDate: "1990-01-01", bearsStory: "Me hice fan de los Bears viendo partidos con mi familia desde México y desde entonces sigo cada temporada.",
  songTitle: "Canción", songArtist: "Artista", songReason: "Esta canción representa los recuerdos que comparto con mi familia cada semana.",
  rulesAccepted: "on", privacyAccepted: "on", publicationAccepted: "on", requestAcknowledged: "on",
})) validForm.set(name, value);
const submission = validateParticipationForm(validForm, new Date("2026-09-10T12:00:00Z"));
assert.equal(submission.email, "ana@example.com");
for (const phone of ["+52 55 1234 5678", "+1 (312) 555-0188", "+34 612 34 56 78", "+44 20 7946 0958"]) {
  const international = new FormData();
  for (const [name, value] of validForm.entries()) international.set(name, value);
  international.set("phone", phone);
  assert.equal(validateParticipationForm(international, new Date("2026-09-10T12:00:00Z")).phone, phone);
}
for (const phone of ["55 1234 5678", "+52 CALL BEARS", "+1 123 456 7890 12345", "+123"]) {
  const invalidPhone = new FormData();
  for (const [name, value] of validForm.entries()) invalidPhone.set(name, value);
  invalidPhone.set("phone", phone);
  assert.throws(() => validateParticipationForm(invalidPhone, new Date("2026-09-10T12:00:00Z")), /phone/);
}
const minor = new FormData();
for (const [name, value] of validForm.entries()) minor.set(name, value);
minor.set("birthDate", "2010-01-01");
assert.throws(() => validateParticipationForm(minor, new Date("2026-09-10T12:00:00Z")), /birthDate/);
minor.set("birthDate", "2000-02-31");
assert.throws(() => validateParticipationForm(minor, new Date("2026-09-10T12:00:00Z")), /birthDate/);
assert.equal(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");

assert.equal(await verifyTurnstile({
  secret: "test", token: "token", remoteIp: "192.0.2.1",
  fetchImplementation: async () => new Response(JSON.stringify({ success: true, action: "participa" }), { status: 200 }),
}), true);
assert.equal(await verifyTurnstile({
  secret: "test", token: "token",
  fetchImplementation: async () => new Response(JSON.stringify({ success: true, action: "other" }), { status: 200 }),
}), false);

const messages = [];
const emailResult = await sendParticipationEmails({
  env: { BREVO_API_KEY: "test", BREVO_FROM_EMAIL: "stream@fanaticosos.com", PARTICIPATION_ADMIN_EMAIL: "stream@fanaticosos.com" },
  request: { ...submission, fullName: "<Ana>" },
  slot: { stream_date: "2026-11-11", previous_game: "Tampa", next_game: "BYE", special_topic: "Media temporada" },
  requestId: "request-1",
  fetchImplementation: async (_url, options) => {
    messages.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ messageId: `message-${messages.length}` }), { status: 201 });
  },
});
assert.equal(emailResult.status, "sent");
assert.equal(messages.length, 2);
assert.match(messages[0].htmlContent, /&lt;Ana&gt;/);
assert.equal(messages[1].to[0].email, "stream@fanaticosos.com");

console.log("Passed participation backend tests.");
