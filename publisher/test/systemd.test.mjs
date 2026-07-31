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
  assert.match(unit, /IPAddressDeny=any/);
});

test("publisher has a single private write boundary", () => {
  assert.match(unit, /ExecStart=\/opt\/nodejs\/current\/bin\/node/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=\/opt\/fanaticosos-blog\/publisher/);
  assert.match(unit, /User=fanaticosos-blog/);
  assert.match(unit, /UMask=0077/);
});
