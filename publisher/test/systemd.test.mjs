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
  assert.doesNotMatch(dispatcher, /eval /);
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
