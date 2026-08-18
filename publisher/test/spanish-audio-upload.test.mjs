import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveSpanishAudio } from "../lib/spanish-audio-upload.mjs";

const draft = { articleId: "00000000-0000-4000-8000-000000000001", revision: 3, title: "Título", description: "Resumen", body: "Texto." };
const translation = { status: "completed", draftRevision: 3, result: { title: "Title", description: "Summary", body: "Text." } };

test("owner MP3 is revision-bound and completes bilingual audio when English is ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "spanish-upload-"));
  const statesRoot = join(root, "states"); const jobsRoot = join(root, "jobs");
  const { ttsRequestsForDraft } = await import("../lib/tts-jobs.mjs");
  const requests = ttsRequestsForDraft(draft, translation);
  await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(statesRoot, { recursive: true }).then(() => writeFile(join(statesRoot, `audio-${draft.articleId}.json`), JSON.stringify({ articleId: draft.articleId, draftRevision: 3, status: "awaiting-upload", workflow: "preview", sourceRevisions: { es: requests.es.sourceRevision, en: requests.en.sourceRevision }, jobs: { es: { status: "awaiting-upload" }, en: { jobId: "tts-en-existing", status: "completed", result: { file: "en.mp3" } } } }))));
  const audio = await saveSpanishAudio({ draft, translation, buffer: Buffer.alloc(2048, 1), jobsRoot, statesRoot, policyRevision: "f".repeat(64), probe: async () => ({ streams: [{ codec_name: "mp3", sample_rate: "44100", channels: 2 }], format: { duration: "321.5" } }) });
  assert.equal(audio.status, "completed");
  assert.match(audio.jobs.es.jobId, /^upload-es-/);
  assert.equal(audio.jobs.es.result.file, `es-${draft.articleId}.mp3`);
  assert.equal(audio.jobs.es.result.durationSeconds, 321.5);
  assert.equal((await readFile(join(jobsRoot, audio.jobs.es.jobId, "audio", audio.jobs.es.result.file))).length, 2048);
});
