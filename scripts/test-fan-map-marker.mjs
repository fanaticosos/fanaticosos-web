import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/components/FanMap.astro", import.meta.url), "utf8");

assert.match(source, /draggable:\s*true/, "the provisional marker must be draggable");
assert.match(source, /draftMarker\.setLatLng\(\[roundedLat, roundedLng\]\)/, "a later map click must move the existing marker");
assert.match(source, /draftMarker\.on\("dragend",\s*\(\)\s*=>\s*setPoint\(draftMarker\.getLatLng\(\)\)\)/, "dragging must update the submitted coordinates");

console.log("Passed fan map marker repositioning tests.");
