import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const JOB_ID = /^translation-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/;
const JOB_TIMEOUT_MS = 7 * 60 * 1000;

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8", mode: 0o600, flag: "wx",
  });
  await rename(temporary, path);
}

function bodySegments(body) {
  const parts = body.split(/(\n\s*\n)/);
  const segments = [];
  const layout = [];
  let sequence = 0;
  for (const part of parts) {
    if (/^\n\s*\n$/.test(part)) {
      layout.push({ separator: part });
      continue;
    }
    if (!part.trim()) continue;
    sequence += 1;
    const id = `body-${String(sequence).padStart(3, "0")}`;
    const marker = /^(#{1,6}\s+|>\s*|(?:[-*+]\s+)|(?:\d+[.)]\s+))/.exec(part);
    const prefix = marker?.[0] ?? "";
    const text = part.slice(prefix.length).trim();
    segments.push({ id, kind: prefix.startsWith("#") ? "heading" : prefix.startsWith(">") ? "quote" : /^(?:[-*+]|\d)/.test(prefix) ? "list-item" : "paragraph", text });
    layout.push({ id, prefix });
  }
  return { segments, layout };
}

export function translationRequestForDraft(draft) {
  const body = bodySegments(draft.body);
  if (body.segments.length + 2 > 512) throw new Error("the article has too many translation segments");
  if (body.segments.some((segment) => segment.text.length > 12_000)) throw new Error("an article paragraph is too long for translation");
  return {
    request: {
      schemaVersion: 1,
      articleId: draft.articleId,
      sourceLocale: "es",
      targetLocale: "en",
      segments: [
        { id: "title", kind: "title", text: draft.title },
        { id: "description", kind: "description", text: draft.description },
        ...body.segments,
      ],
    },
    bodyLayout: body.layout,
  };
}

export async function queueTranslation({ draft, queueRoot, statesRoot, now = new Date() }) {
  const jobId = `translation-${draft.articleId.replaceAll("-", "")}-r${draft.revision}-${randomUUID().slice(0, 8)}`;
  if (!JOB_ID.test(jobId)) throw new Error("translation job identity is invalid");
  await mkdir(queueRoot, { recursive: true, mode: 0o700 });
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const statePath = join(statesRoot, `${draft.articleId}.json`);
  try {
    const existing = JSON.parse(await readFile(statePath, "utf8"));
    if (["queued", "running"].includes(existing.status)) throw new Error("translation is already running");
    if (existing.draftRevision === draft.revision && existing.status === "completed") {
      throw new Error("this draft revision is already translated");
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !/already/.test(error.message)) throw error;
    if (/already/.test(error.message)) throw error;
  }
  const { request, bodyLayout } = translationRequestForDraft(draft);
  const temporary = join(queueRoot, `.${jobId}.${randomUUID()}.queuing`);
  const target = join(queueRoot, jobId);
  await mkdir(temporary, { mode: 0o700 });
  await atomicJson(join(temporary, "request.json"), request);
  await rename(temporary, target);
  const state = {
    schemaVersion: 1, articleId: draft.articleId, draftRevision: draft.revision,
    jobId, status: "queued", createdAt: now.toISOString(), updatedAt: now.toISOString(),
    bodyLayout,
  };
  await atomicJson(statePath, state);
  await writeFile(join(queueRoot, ".wake"), "\n", { mode: 0o600 });
  return state;
}

export async function readTranslationState(statesRoot, articleId) {
  return JSON.parse(await readFile(join(statesRoot, `${articleId}.json`), "utf8"));
}

export function renderEnglish(result, state) {
  const values = new Map(result.segments.map((segment) => [segment.id, segment.translation]));
  if (!values.has("title") || !values.has("description")) throw new Error("translation result is incomplete");
  const body = state.bodyLayout.map((entry) => entry.separator ?? `${entry.prefix}${values.get(entry.id) ?? ""}`).join("");
  return { title: values.get("title"), description: values.get("description"), body };
}

export async function reconcileTranslations({ statesRoot, jobsRoot, onComplete, onFailure, now = new Date() }) {
  await mkdir(statesRoot, { recursive: true, mode: 0o700 });
  const names = (await readdir(statesRoot)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
  for (const name of names) {
    const path = join(statesRoot, name);
    const state = JSON.parse(await readFile(path, "utf8"));
    if (!["queued", "running"].includes(state.status)) continue;
    const job = join(jobsRoot, state.jobId);
    try {
      const result = JSON.parse(await readFile(join(job, "result.json"), "utf8"));
      state.status = "completed";
      state.result = renderEnglish(result, state);
      state.sourceRevision = result.sourceRevision;
      state.updatedAt = now.toISOString();
      await atomicJson(path, state);
      await onComplete?.(state);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const failure = JSON.parse(await readFile(join(job, "failed-output.json"), "utf8"));
      state.status = "failed";
      state.error = failure.error || "La traducción no pasó la validación.";
      state.updatedAt = now.toISOString();
      await atomicJson(path, state);
      await onFailure?.(state);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (state.status === "queued") {
      try {
        await readFile(join(job, "request.json"));
        state.status = "running";
        state.updatedAt = now.toISOString();
        await atomicJson(path, state);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (now.getTime() - new Date(state.createdAt).getTime() > JOB_TIMEOUT_MS) {
      state.status = "failed";
      state.error = "La traducción excedió su límite automático y fue detenida.";
      state.updatedAt = now.toISOString();
      await atomicJson(path, state);
      await onFailure?.(state);
    }
  }
}
