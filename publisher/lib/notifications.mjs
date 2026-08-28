import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEVELS = new Set(["info", "success", "error"]);

async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

export async function createNotification(root, value, now = new Date()) {
  if (!LEVELS.has(value.level)) throw new Error("notification level is invalid");
  if (typeof value.message !== "string" || !value.message.trim()) {
    throw new Error("notification message is required");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (value.replacePending) {
    const pending = (await listNotifications(root)).filter((item) => (
      !item.acknowledgedAt
      && item.event === value.event
      && item.articleId === (value.articleId ?? null)
    ));
    await Promise.all(pending.map((item) => acknowledgeNotification(root, item.id, now)));
  }
  const notification = {
    schemaVersion: 1,
    id: randomUUID(),
    level: value.level,
    event: value.event,
    articleId: value.articleId ?? null,
    message: value.message.trim(),
    createdAt: now.toISOString(),
    acknowledgedAt: null,
  };
  await atomicWrite(join(root, `${notification.id}.json`), notification);
  return notification;
}

export async function listNotifications(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const names = (await readdir(root)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
  const values = await Promise.all(names.map(async (name) => JSON.parse(
    await readFile(join(root, name), "utf8"),
  )));
  return values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function acknowledgeNotification(root, id, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("notification id is invalid");
  const path = join(root, `${id}.json`);
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.id !== id || value.schemaVersion !== 1) throw new Error("notification identity is invalid");
  value.acknowledgedAt ??= now.toISOString();
  await atomicWrite(path, value);
  return value;
}

export async function acknowledgeAllNotifications(root, now = new Date()) {
  const pending = (await listNotifications(root)).filter((item) => !item.acknowledgedAt);
  await Promise.all(pending.map((item) => acknowledgeNotification(root, item.id, now)));
  return pending.length;
}
