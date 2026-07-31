import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TYPES = {
  "image/jpeg": { extension: "jpg", signature: (value) => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff },
  "image/png": { extension: "png", signature: (value) => value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { extension: "webp", signature: (value) => value.subarray(0, 4).toString() === "RIFF" && value.subarray(8, 12).toString() === "WEBP" },
};

export function validateImage(value, contentType) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw new Error("image is empty");
  if (value.length > MAX_IMAGE_BYTES) throw new Error("image exceeds 12 MB");
  const selected = TYPES[contentType];
  if (!selected || !selected.signature(value)) throw new Error("image type or signature is invalid");
  return selected.extension;
}

export async function saveImage(root, value, contentType) {
  const extension = validateImage(value, contentType);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.${extension}`;
  const target = join(root, name);
  const temporary = `${target}.uploading`;
  await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  return { name, path: `/uploads/${name}`, contentType, sizeBytes: value.length };
}

export function contentTypeForName(name) {
  if (/^[0-9a-f-]{36}\.jpg$/.test(name)) return "image/jpeg";
  if (/^[0-9a-f-]{36}\.png$/.test(name)) return "image/png";
  if (/^[0-9a-f-]{36}\.webp$/.test(name)) return "image/webp";
  return null;
}
