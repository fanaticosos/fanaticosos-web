import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "fanaticosos-functions-"));
try {
  const routes = join(directory, "routes.json");
  const result = spawnSync(resolve("node_modules/.bin/wrangler"), [
    "pages", "functions", "build", "functions", "--outdir", directory,
    "--output-routes-path", routes, "--compatibility-date", "2026-09-10",
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Pages Functions compilation failed");
  const config = JSON.parse(await readFile(routes, "utf8"));
  for (const route of ["/api/participa", "/api/participa/config", "/api/participa/slots", "/api/admin/invitados", "/api/admin/invitados/action"]) {
    if (!config.include?.includes(route)) throw new Error(`Pages Functions route missing: ${route}`);
  }
  console.log(`Validated ${config.include.length} Pages Functions routes.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
