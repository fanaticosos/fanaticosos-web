import assert from "node:assert/strict";
import source from "../src/data/participation-slots.json" with { type: "json" };
import { participationSlotsSchema } from "../src/lib/participationSlotsSchema.mjs";

const value = participationSlotsSchema.parse(source);
assert.equal(value.slots.length, 16);
assert.equal(value.slots.filter((slot) => slot.status === "available").length, 16);
assert.equal(value.slots.find((slot) => slot.id === "2026-11-11")?.nextGame, "BYE — semana de descanso");
assert.match(value.slots.find((slot) => slot.id === "2026-11-11")?.specialTopic ?? "", /media temporada/);
assert.throws(() => participationSlotsSchema.parse({ ...source, slots: [source.slots[0], source.slots[0]] }), /Slot IDs must be unique/);
console.log("Passed participation schedule tests.");
