import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATUSES = new Set(["draft", "review", "ready"]);

function requiredText(value, field, maximum) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  const selected = value.trim();
  if (selected.length > maximum) throw new Error(`${field} is too long`);
  return selected;
}

function optionalText(value, field, maximum) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const selected = value.trim();
  if (selected.length > maximum) throw new Error(`${field} is too long`);
  return selected;
}

export function validateOwnerFields(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("draft must be an object");
  }
  const status = value.status ?? "draft";
  if (!STATUSES.has(status)) throw new Error("status is invalid");
  const tags = value.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 20) throw new Error("tags are invalid");
  const normalizedTags = tags.map((tag) => requiredText(tag, "tag", 50));
  if (new Set(normalizedTags.map((tag) => tag.toLocaleLowerCase("es-MX"))).size !== normalizedTags.length) {
    throw new Error("tags must be unique");
  }
  const featuredImage = value.featuredImage ?? {};
  if (featuredImage == null || typeof featuredImage !== "object" || Array.isArray(featuredImage)) {
    throw new Error("featuredImage is invalid");
  }
  const imagePath = optionalText(featuredImage.path, "featuredImage.path", 500);
  const imageAlt = optionalText(featuredImage.alt, "featuredImage.alt", 500);
  const imageCredit = optionalText(featuredImage.credit, "featuredImage.credit", 500);
  if (imagePath && (!imageAlt || !imageCredit)) {
    throw new Error("featured images require alternative text and credit");
  }
  if (!Number.isInteger(value.season) || value.season < 2000 || value.season > 2100) {
    throw new Error("season is invalid");
  }
  return {
    title: requiredText(value.title, "title", 300),
    description: requiredText(value.description, "description", 500),
    body: requiredText(value.body, "body", 100_000),
    category: requiredText(value.category, "category", 100),
    season: value.season,
    tags: normalizedTags,
    status,
    featuredImage: {
      path: imagePath,
      alt: imageAlt,
      caption: optionalText(featuredImage.caption, "featuredImage.caption", 500),
      credit: imageCredit,
    },
  };
}

export function newDraft(ownerFields, now = new Date()) {
  return {
    schemaVersion: 1,
    articleId: randomUUID(),
    revision: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...validateOwnerFields(ownerFields),
  };
}

export async function readDraft(root, articleId) {
  const value = JSON.parse(await readFile(join(root, `${articleId}.json`), "utf8"));
  if (value.articleId !== articleId || value.schemaVersion !== 1) {
    throw new Error("stored draft identity is invalid");
  }
  return value;
}

export async function listDrafts(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const names = (await readdir(root)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
  const drafts = await Promise.all(names.map((name) => readDraft(root, name.slice(0, -5))));
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function writeDraft(root, draft) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, `${draft.articleId}.json`);
  const temporary = `${target}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, target);
  return draft;
}

export async function updateDraft(root, articleId, expectedRevision, ownerFields, now = new Date()) {
  const existing = await readDraft(root, articleId);
  if (existing.revision !== expectedRevision) {
    throw new Error("draft was changed in another browser session");
  }
  return writeDraft(root, {
    ...existing,
    ...validateOwnerFields(ownerFields),
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  });
}
