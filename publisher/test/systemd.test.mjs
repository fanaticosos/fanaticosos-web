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

test("publisher database and backups stay inside the private data boundary", () => {
  assert.match(unit, /Environment=PUBLISHER_DATABASE_PATH=\/opt\/fanaticosos-blog\/publisher\/database\/publisher\.sqlite/);
  assert.match(unit, /Environment=PUBLISHER_DATABASE_BACKUP_ROOT=\/opt\/fanaticosos-blog\/publisher\/backups\/database/);
  assert.match(unit, /Environment=PUBLISHER_TRANSLATION_ARTIFACTS_ROOT=\/opt\/fanaticosos-blog\/publisher\/artifacts\/translations/);
  assert.match(unit, /Environment=PUBLISHER_AUDIO_ARTIFACTS_ROOT=\/opt\/fanaticosos-blog\/publisher\/artifacts\/audio/);
  assert.match(unit, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher/);
});

test("publisher dispatches jobs through a separate fixed systemd path", async () => {
  const pathUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-publisher-dispatcher.path", import.meta.url), "utf8");
  const serviceUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-publisher-dispatcher.service", import.meta.url), "utf8");
  const dispatcher = await readFile(new URL("../../deploy/publisher/fanaticosos-publisher-dispatcher", import.meta.url), "utf8");
  assert.match(dispatcher, /claim_database_job\.mjs/);
  assert.match(dispatcher, /claim_job "\$job_id"/);
  assert.match(dispatcher, /claim_job "\$deploy_id"/);
  assert.match(serviceUnit, /ReadWritePaths=.*\/publisher\/database/);
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

test("TTS worker failures become private reconciliation evidence", async () => {
  const ttsUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-tts@.service", import.meta.url), "utf8");
  const recorder = await readFile(new URL("../../scripts/publisher/record_tts_exit.mjs", import.meta.url), "utf8");
  assert.match(ttsUnit, /ExecStopPost=.*record_tts_exit\.mjs/);
  assert.match(ttsUnit, /ReadWritePaths=\/opt\/fanaticosos-blog\/jobs\/%i/);
  assert.match(recorder, /La generación de audio no pudo completarse/);
});

test("music publication builds privately then deploys through a root-only unit", async () => {
  const build = await readFile(new URL("../../deploy/systemd/fanaticosos-music-release@.service", import.meta.url), "utf8");
  const deploy = await readFile(new URL("../../deploy/systemd/fanaticosos-music-deploy@.service", import.meta.url), "utf8");
  const failureRecorder = await readFile(new URL("../../scripts/publisher/record_music_deploy_exit.mjs", import.meta.url), "utf8");
  assert.match(build, /User=fanaticosos-blog/);
  assert.match(build, /PrivateNetwork=yes/);
  assert.match(build, /OnSuccess=fanaticosos-music-deploy@%i\.service/);
  assert.match(deploy, /deploy_music_release\.sh/);
  assert.match(deploy, /record_music_deploy_exit\.mjs/);
  assert.doesNotMatch(deploy, /User=fanaticosos-blog/);
  assert.match(failureRecorder, /await chown\(temporary, owner\.uid, owner\.gid\)/);
});

test("every validated production deployment becomes the source for later music builds", async () => {
  const production = await readFile(new URL("../../scripts/deployment/deploy_cloudflare_production.sh", import.meta.url), "utf8");
  const articleBuild = await readFile(new URL("../../scripts/publisher/build_release.mjs", import.meta.url), "utf8");
  const productionUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-production-deploy@.service", import.meta.url), "utf8");
  const failureRecorder = await readFile(new URL("../../scripts/publisher/record_production_deploy_exit.mjs", import.meta.url), "utf8");
  const music = await readFile(new URL("../../scripts/deployment/deploy_music_release.sh", import.meta.url), "utf8");
  const musicBuild = await readFile(new URL("../../scripts/publisher/build_music_release.mjs", import.meta.url), "utf8");
  assert.match(production, /scripts\/publisher\/select_release\.mjs/);
  assert.match(production, /--releases-root "\$data_root\/publisher\/releases" --job-id "\$job_id"/);
  assert.match(production, /readonly domains=\("https:\/\/fanaticosos\.com"/);
  assert.doesNotMatch(production, /readonly domains=\("\$deployment_url"/);
  assert.match(production, /release homepage checksum is invalid/);
  assert.match(production, /items = \[\("\/", ""\), \(routes\.get\("es"\), ""\), \(routes\.get\("en"\), ""\)\]/);
  assert.match(production, /deployments\/\$rollback_id\/rollback/);
  assert.match(production, /The previous validated deployment was restored/);
  assert.match(articleBuild, /homepageSha256: await sha256\(join\(temporary, "dist", "index\.html"\)\)/);
  assert.match(productionUnit, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher\/releases(?:\n|$)/);
  assert.match(failureRecorder, /await chown\(temporary, owner\.uid, owner\.gid\)/);
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

test("article releases bind immutable application source and Pages Functions", async () => {
  const build = await readFile(new URL("../../scripts/publisher/build_release.mjs", import.meta.url), "utf8");
  const preview = await readFile(new URL("../../scripts/deployment/deploy_cloudflare_preview.sh", import.meta.url), "utf8");
  const production = await readFile(new URL("../../scripts/deployment/deploy_cloudflare_production.sh", import.meta.url), "utf8");
  assert.match(build, /release source commit changed before assembly/);
  assert.match(build, /functionsSha256/);
  assert.doesNotMatch(build, /localeCompare/);
  assert.match(build, /a\.name < b\.name \? -1 : a\.name > b\.name \? 1 : 0/);
  assert.match(build, /complete release must contain exactly 32 NFL logos/);
  assert.match(build, /"\/api\/participa\/config"/);
  for (const deployment of [preview, production]) {
    assert.match(deployment, /release Functions checksum is invalid/);
    assert.doesNotMatch(deployment, /os\.walk\(root\)/);
    assert.match(deployment, /sorted\(os\.scandir\(directory\), key=lambda item: item\.name\)/);
    assert.match(deployment, /cd "\$release_root"/);
    assert.match(deployment, /for path in application\.get\("requiredPaths", \[\]\)/);
    assert.match(deployment, /if path\.startswith\("\/api\/"\)/);
    assert.match(deployment, /for (?:path|item) in "\$\{manifest_values\[@\]:1\}"/);
  }
  assert.match(preview, /status" == 302 && "\$redirect" == https:\/\/fanaticosos\.cloudflareaccess\.com/);
  assert.match(preview, /"accessProtected": access_protected == "true"/);
});

test("article release workers read authoritative SQLite state and immutable audio", async () => {
  const releaseUnit = await readFile(new URL("../../deploy/systemd/fanaticosos-release@.service", import.meta.url), "utf8");
  const builder = await readFile(new URL("../../scripts/publisher/build_release.mjs", import.meta.url), "utf8");
  assert.match(releaseUnit, /--database \/opt\/fanaticosos-blog\/publisher\/database\/publisher\.sqlite/);
  assert.match(builder, /readDatabaseDraft/);
  assert.match(builder, /readDatabaseTranslationState/);
  assert.match(builder, /readDatabaseAudioState/);
  assert.match(builder, /openDatabase\(databasePath, \{ readOnly: true, migrate: false \}\)/);
  assert.match(builder, /accepted audio is outside the private artifact store/);
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
