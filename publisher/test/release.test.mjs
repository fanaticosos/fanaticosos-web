import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";

import settings from "../../config/publisher/defaults.json" with { type: "json" };
import { serializeArticlePair, slugify } from "../lib/release.mjs";

const draft = {
  articleId: "00000000-0000-4000-8000-000000000001", revision: 2,
  title: "Los Bears ganan en Chicago", description: "Resumen", body: "Contenido.",
  category: "Chicago Bears", tags: ["#BearDown"], featuredImage: {},
};
const translation = {
  status: "completed", draftRevision: 2, sourceRevision: "a".repeat(64),
  result: { title: "The Bears win in Chicago", description: "Summary", body: "Content." },
  provenance: { engine: "llama.cpp", model: "Qwen", configurationVersion: "6", glossaryVersion: 5, generatedAt: "2026-07-31T12:00:00Z" },
};
const audioResult = (locale) => ({ file: `${locale}-${draft.articleId}.mp3`, durationSeconds: 10, voice: locale === "es" ? "Jorge" : "af_heart", engine: locale === "es" ? "Azure Speech" : "Kokoro", textHash: "b".repeat(64), generatedAt: "2026-07-31T12:01:00Z" });
const audio = { status: "completed", draftRevision: 2, jobs: { es: { jobId: "tts-es-test", result: audioResult("es") }, en: { jobId: "tts-en-test", result: audioResult("en") } } };

test("accepted draft serializes as a bilingual publishable pair", () => {
  assert.equal(slugify("Temporada número 3"), "temporada-numero-3");
  const release = serializeArticlePair({ draft, translation, audio, settings, publishedAt: "2026-07-31T09:00:00-05:00" });
  const spanish = release.files[`src/content/articles/es/${draft.articleId}.md`];
  const english = release.files[`src/content/articles/en/${draft.articleId}.md`];
  const data = yaml.load(spanish.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.equal(data.status, "published");
  assert.equal(data.audio.voice, "Jorge");
  assert.match(spanish, /¡Gracias por acompañarnos!/);
  assert.match(english, /Thank you for joining us!/);
  assert.match(english, /translation:/);
  assert.equal(release.assets.enAudio.publicPath, `public/audio/en-${draft.articleId}.mp3`);
});
