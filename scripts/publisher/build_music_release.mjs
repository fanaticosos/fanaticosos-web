#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { siteSettingsSchema } from "../../src/lib/siteSettingsSchema.mjs";

const execute = promisify(execFile);
function argument(name) { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} is required`); return resolve(process.argv[i + 1]); }

async function main() {
  const requestPath = argument("--request");
  const repository = argument("--repository");
  const releasesRoot = argument("--releases-root");
  const output = argument("--output");
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  if (request.schemaVersion !== 1 || request.releaseKind !== "music") throw new Error("music release request is invalid");
  const settings = siteSettingsSchema.parse(request.settings);
  if (process.argv.includes("--validate-only")) return;
  const current = await lstat(join(releasesRoot, "current")).then((value) => value.isSymbolicLink());
  if (!current) throw new Error("a validated selected release is required");
  const temporary = `${output}.building`;
  await lstat(output).then(() => { throw new Error("music release output already exists"); }, (e) => { if (e.code !== "ENOENT") throw e; });
  await cp(repository, temporary, { recursive: true, filter: (source) => ![".git", "node_modules", ".astro", "dist"].includes(basename(source)) });
  const selected = join(releasesRoot, "current");
  for (const relative of ["src/content/articles", "public/audio", "public/uploads"]) {
    const source = join(selected, relative);
    const exists = await lstat(source).then(() => true).catch((error) => { if (error.code === "ENOENT") return false; throw error; });
    if (exists) await cp(source, join(temporary, relative), { recursive: true, force: true });
  }
  const modules = join(temporary, "node_modules");
  await mkdir(modules, { mode: 0o700 });
  for (const entry of await readdir(join(repository, "node_modules"))) {
    if (![".astro", ".vite"].includes(entry)) await symlink(join(repository, "node_modules", entry), join(modules, entry));
  }
  await writeFile(join(temporary, "src/data/site-settings.json"), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rm(join(temporary, "release-manifest.json"), { force: true });
  await execute("/opt/nodejs/current/bin/npm", ["run", "build"], { cwd: temporary, env: { ...process.env, NODE_ENV: "production" }, maxBuffer: 10_000_000 });
  const homepage = await readFile(join(temporary, "dist/index.html"), "utf8");
  for (const expected of [settings.music.weeklySong.title, settings.music.weeklySong.streamUrl, settings.music.weeklySongUrl]) {
    if (!homepage.includes(expected.replaceAll("&", "&amp;")) && !homepage.includes(expected)) throw new Error(`homepage is missing weekly-song value: ${expected}`);
  }
  const manifest = JSON.parse(await readFile(join(releasesRoot, "current/release-manifest.json"), "utf8"));
  const { stdout: commit } = await execute("git", ["-C", repository, "rev-parse", "HEAD"]);
  Object.assign(manifest, { commit: commit.trim(), releaseKind: "music", musicUpdatedAt: new Date().toISOString(), homepageSha256: createHash("sha256").update(homepage).digest("hex"), deployment: "disabled" });
  await writeFile(join(temporary, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await mkdir(resolve(output, ".."), { recursive: true, mode: 0o700 });
  await rename(temporary, output);
  console.log(`PASS: Music-only release built for ${settings.music.weeklySong.title}.`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
