import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownToNarrationScript, narrationSegmentsFromScript,
  normalizeNarrationScript, plainNarrationText, stripEditorialMasthead,
} from "../lib/narration-scripts.mjs";

test("editorial masthead is excluded from translation and narration", () => {
  const body = "**Por:** *Fanaticosos*\\\n**Fecha:** 14 de septiembre de 2026\\\n**Ubicación:** Charlotte, Carolina del Norte\n\n## Partido\n\nLos Bears ganaron.";
  assert.equal(stripEditorialMasthead(body), "## Partido\n\nLos Bears ganaron.");
  assert.equal(markdownToNarrationScript(body, plainNarrationText), "Partido\n<pause=0.9s>\nLos Bears ganaron.");
});

test("English editorial masthead is also excluded from narration", () => {
  const body = "**By:** *Fanaticosos*\\\n**Date:** September 14, 2026\\\n**Location:** Charlotte, North Carolina\n\nThe Bears won.";
  assert.equal(stripEditorialMasthead(body), "The Bears won.");
});

test("plain bilingual scripts accept bounded pauses and reject Markdown", () => {
  const script = normalizeNarrationScript("Primera parte.\n<pause=0.7s>\nSegunda parte.");
  assert.equal(script, "Primera parte.\n<pause=0.7s>\nSegunda parte.");
  assert.deepEqual(narrationSegmentsFromScript(script).map(({ text, pauseAfterMs }) => ({ text, pauseAfterMs })), [
    { text: "Primera parte.", pauseAfterMs: 700 },
    { text: "Segunda parte.", pauseAfterMs: 0 },
  ]);
  assert.throws(() => normalizeNarrationScript("**No Markdown**"), /without Markdown/);
  assert.throws(() => normalizeNarrationScript("Texto. <pause=9s>"), /invalid pause/);
});

test("generated narration removes quote and list syntax without losing spoken text", () => {
  const body = "> “Así queremos vernos.”\n>\n> — **Caleb Williams**\n\n1. Primera posesión.\n2. Segunda posesión.";
  const script = markdownToNarrationScript(body, plainNarrationText);
  assert.equal(script, "“Así queremos vernos.”\n— Caleb Williams\n<pause=0.7s>\nPrimera posesión.\nSegunda posesión.");
  assert.doesNotThrow(() => normalizeNarrationScript(script));
});
