import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const unit = await readFile(
  new URL("../../deploy/systemd/fanaticosos-publisher.service", import.meta.url),
  "utf8",
);

test("publisher binds only to the Papabear NetBird address", () => {
  assert.match(unit, /Environment=PUBLISHER_HOST=100\.121\.48\.92/);
  assert.doesNotMatch(unit, /PUBLISHER_HOST=0\.0\.0\.0/);
  assert.match(unit, /IPAddressAllow=100\.64\.0\.0\/10/);
  assert.match(unit, /IPAddressAllow=192\.168\.1\.10\/32/);
  assert.match(unit, /IPAddressDeny=any/);
});

test("publisher has a single private write boundary", () => {
  assert.match(unit, /ExecStart=\/opt\/nodejs\/current\/bin\/node/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher/);
  assert.match(unit, /\/opt\/fanaticosos-blog\/jobs/);
  assert.match(unit, /User=fanaticosos-blog/);
  assert.match(unit, /UMask=0077/);
});

test("publisher dispatches jobs through a separate fixed systemd path", async () => {
  const pathUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-publisher-dispatcher.path", import.meta.url), "utf8");
  const serviceUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-publisher-dispatcher.service", import.meta.url), "utf8");
  const dispatcher = await readFile(new URL("../../deploy/publisher/fanaticosos-publisher-dispatcher", import.meta.url), "utf8");
  assert.match(unit, /NoNewPrivileges=yes/);
  assert.match(pathUnit, /PathExists=\/opt\/fanaticosos-blog\/publisher\/queue\/\.wake/);
  assert.match(serviceUnit, /ExecStart=\/usr\/local\/sbin\/fanaticosos-publisher-dispatcher/);
  assert.match(dispatcher, /validate_translation_request/);
  assert.match(dispatcher, /from article_contract import validate_request/);
  assert.match(dispatcher, /systemctl start --no-block/);
  assert.match(dispatcher, /fanaticosos-tts@\$job_id\.service/);
  assert.match(dispatcher, /fanaticosos-release@\$job_id\.service/);
  assert.match(dispatcher, /build_release\.mjs[^\n]*--releases-root "\$releases_root"/);
  assert.match(dispatcher, /fanaticosos-music-release@\$job_id\.service/);
  assert.doesNotMatch(dispatcher, /eval /);
});

test("music publication builds privately then deploys through a root-only unit", async () => {
  const build = await readFile(new URL("../../deploy/systemd/fanaticosos-music-release@.service", import.meta.url), "utf8");
  const deploy = await readFile(new URL("../../deploy/systemd/fanaticosos-music-deploy@.service", import.meta.url), "utf8");
  assert.match(build, /User=fanaticosos-blog/);
  assert.match(build, /PrivateNetwork=yes/);
  assert.match(build, /OnSuccess=fanaticosos-music-deploy@%i\.service/);
  assert.match(deploy, /deploy_music_release\.sh/);
  assert.match(deploy, /record_music_deploy_exit\.mjs/);
  assert.doesNotMatch(deploy, /User=fanaticosos-blog/);
});

test("every validated production deployment becomes the source for later music builds", async () => {
  const production = await readFile(new URL("../../scripts/deployment/deploy_cloudflare_production.sh", import.meta.url), "utf8");
  const productionUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-production-deploy@.service", import.meta.url), "utf8");
  const music = await readFile(new URL("../../scripts/deployment/deploy_music_release.sh", import.meta.url), "utf8");
  const musicBuild = await readFile(new URL("../../scripts/publisher/build_music_release.mjs", import.meta.url), "utf8");
  assert.match(production, /scripts\/publisher\/select_release\.mjs/);
  assert.match(production, /--releases-root "\$data_root\/publisher\/releases" --job-id "\$job_id"/);
  assert.match(productionUnit, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher\/releases(?:\n|$)/);
  assert.doesNotMatch(music, /select_release\.mjs/);
  assert.match(musicBuild, /"src\/content\/articles", "public\/audio", "public\/images", "public\/uploads"/);
});

test("article releases preserve the selected production content set", async () => {
  const build = await readFile(new URL("../../scripts/publisher/build_release.mjs", import.meta.url), "utf8");
  const releaseUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-release@.service", import.meta.url), "utf8");
  assert.match(build, /"src\/content\/articles", "public\/audio", "public\/images", "public\/uploads"/);
  assert.match(build, /join\(releasesRoot, "current"\)/);
  assert.match(releaseUnit, /--releases-root \/opt\/fanaticosos-blog\/publisher\/releases/);
});

test("release retention is fixed, private, and bounded by the approved policy", async () => {
  const service = await readFile(new URL("../../deploy/systemd/fanaticosos-release-retention.service", import.meta.url), "utf8");
  const timer = await readFile(new URL("../../deploy/systemd/fanaticosos-release-retention.timer", import.meta.url), "utf8");
  assert.match(service, /--keep-successful 10 --failed-days 30 --apply/);
  assert.match(service, /PrivateNetwork=yes/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher\/releases/);
  assert.match(timer, /OnCalendar=daily/);
  assert.match(timer, /Persistent=true/);
});
