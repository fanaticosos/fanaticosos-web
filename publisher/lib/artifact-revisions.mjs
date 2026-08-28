import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { translationSourceRevision } from "./translation-jobs.mjs";
import { ttsRequestsForDraft } from "./tts-jobs.mjs";

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function rebaseReusableArtifacts({ draft, statesRoot, now = new Date() }) {
  const translationPath = join(statesRoot, `${draft.articleId}.json`);
  const audioPath = join(statesRoot, `audio-${draft.articleId}.json`);
  const translation = await optionalJson(translationPath);
  if (!translation || translation.status !== "completed" || translation.sourceRevision !== translationSourceRevision(draft)) {
    return { translation: false, audio: false };
  }

  let audioRebased = false;
  const audio = await optionalJson(audioPath);
  if (audio?.status === "completed" && audio.draftRevision !== draft.revision) {
    const legacyRequests = ttsRequestsForDraft({ ...draft, revision: audio.draftRevision }, translation);
    if (audio.sourceRevisions?.es === legacyRequests.es.sourceRevision && audio.sourceRevisions?.en === legacyRequests.en.sourceRevision) {
      const currentRequests = ttsRequestsForDraft(draft, translation);
      audio.draftRevision = draft.revision;
      audio.sourceRevisions = { es: currentRequests.es.sourceRevision, en: currentRequests.en.sourceRevision };
      audio.updatedAt = now.toISOString();
      await atomicJson(audioPath, audio);
      audioRebased = true;
    }
  }

  const translationRebased = translation.draftRevision !== draft.revision;
  if (translationRebased) {
    translation.draftRevision = draft.revision;
    translation.updatedAt = now.toISOString();
    await atomicJson(translationPath, translation);
  }
  return { translation: translationRebased, audio: audioRebased };
}
