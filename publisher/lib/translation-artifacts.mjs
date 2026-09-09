import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function translationArtifactBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTranslationArtifact(root, value) {
  const bytes = translationArtifactBytes(value);
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = join(root, value.articleId);
  const path = join(directory, `${value.sourceRevision}-${checksumSha256}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(path);
    if (!existing.equals(bytes)) throw new Error("translation artifact checksum collision");
    return { path, checksumSha256, created: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${randomUUID()}.saving`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return { path, checksumSha256, created: true };
}
