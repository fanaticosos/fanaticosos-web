#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { gameCenterSchema } from "../../src/lib/gameCenterSchema.mjs";

const execute = promisify(execFile);
function argument(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`); return resolve(process.argv[index + 1]); }
async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

async function directorySha256(root) {
  const hash = createHash("sha256");
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true }).then((items) => items.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) { hash.update(relative); hash.update("\0"); hash.update(await readFile(path)); hash.update("\0"); }
      else throw new Error(`release function source is not a regular file: ${relative}`);
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function main() {
  const repository = argument("--repository");
  const releasesRoot = argument("--releases-root");
  const candidatePath = argument("--candidate");
  const output = argument("--output");
  const candidate = gameCenterSchema.parse(JSON.parse(await readFile(candidatePath, "utf8")));
  const selected = join(releasesRoot, "current");
  if (!await lstat(selected).then((value) => value.isSymbolicLink()).catch(() => false)) throw new Error("a validated selected release is required");
  const previousManifest = JSON.parse(await readFile(join(selected, "release-manifest.json"), "utf8"));
  const temporary = `${output}.building`;
  await lstat(output).then(() => { throw new Error("game-center release output already exists"); }, (error) => { if (error.code !== "ENOENT") throw error; });
  await rm(temporary, { recursive: true, force: true });
  await cp(repository, temporary, { recursive: true, filter: (source) => ![".git", "node_modules", ".astro", "dist"].includes(basename(source)) });
  for (const relative of ["src/content/articles", "public/audio", "public/images", "public/uploads", "src/data/site-settings.json"]) {
    const source = join(selected, relative);
    if (await lstat(source).then(() => true).catch(() => false)) await cp(source, join(temporary, relative), { recursive: true, force: true });
  }
  await mkdir(join(temporary, "src/data"), { recursive: true });
  await writeFile(join(temporary, "src/data/game-center.json"), `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  const modules = join(temporary, "node_modules");
  await mkdir(modules, { mode: 0o700 });
  for (const entry of await readdir(join(repository, "node_modules"))) if (![".astro", ".vite"].includes(entry)) await symlink(join(repository, "node_modules", entry), join(modules, entry));
  await rm(join(temporary, "release-manifest.json"), { force: true });
  await execute("/opt/nodejs/current/bin/npm", ["run", "build"], {
    cwd: temporary,
    env: { ...process.env, NODE_ENV: "production", FANATICOSOS_PRIVATE_RELEASE_BUILD: "1", FANATICOSOS_RELEASE_ARTICLE_ID: previousManifest.articleId },
    maxBuffer: 10_000_000,
  });
  const homepage = await readFile(join(temporary, "dist/index.html"), "utf8");
  for (const expected of [candidate.previousGame?.home?.name, candidate.previousGame?.away?.name, candidate.nextGame?.home?.name, candidate.nextGame?.away?.name].filter(Boolean)) {
    if (!homepage.includes(expected)) throw new Error(`homepage is missing Game Center team: ${expected}`);
  }
  const { stdout: commit } = await execute("git", ["-C", repository, "rev-parse", "HEAD"]);
  const logoFiles = (await readdir(join(temporary, "dist/assets/nfl-logos"))).filter((name) => name.endsWith(".png"));
  if (logoFiles.length !== 32) throw new Error("complete release must contain exactly 32 NFL logos");
  const manifest = {
    ...previousManifest,
    commit: commit.trim(),
    releaseKind: "game-center",
    gameCenterUpdatedAt: candidate.updatedAt,
    gameCenterSha256: await sha256(join(temporary, "src/data/game-center.json")),
    homepageSha256: createHash("sha256").update(homepage).digest("hex"),
    application: { ...previousManifest.application, functionsSha256: await directorySha256(join(temporary, "functions")), nflLogoCount: 32 },
    buildCompletedAt: new Date().toISOString(),
    deployment: "disabled",
  };
  await writeFile(join(temporary, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await rename(temporary, output);
  console.log(`PASS: Game Center release built through ${candidate.updatedAt}.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
