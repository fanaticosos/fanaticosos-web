import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownToNarrationScript, narrationSegmentsFromScript,
  normalizeNarrationCadence, normalizeNarrationScript, plainNarrationText, stripEditorialMasthead,
} from "../lib/narration-scripts.mjs";

test("editorial masthead is excluded from translation and narration", () => {
  const body = "**Por:** *Fanaticosos*\\\n**Fecha:** 14 de septiembre de 2026\\\n**Ubicación:** Charlotte, Carolina del Norte\n\n## Partido\n\nLos Bears ganaron.";
  assert.equal(stripEditorialMasthead(body), "## Partido\n\nLos Bears ganaron.");
  assert.equal(markdownToNarrationScript(body, plainNarrationText), "Partido\n<pause=0.9s>\nLos Bears ganaron.");
});

test("saved plain-text scripts receive stable quote attribution cadence", () => {
  const script = normalizeNarrationCadence("“Fue un golpe importante.”\n— Caleb Williams\n<pause=0.7s>\nWilliams señaló esa jugada.");
  assert.equal(script, "“Fue un golpe importante.”\n<pause=0.3s>\n— Caleb Williams\n<pause=0.9s>\nWilliams señaló esa jugada.");
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

test("generated Spanish narration removes quote and list syntax with quote cadence", () => {
  const body = "> “Así queremos vernos.”\n>\n> — **Caleb Williams**\n\n1. Primera posesión.\n2. Segunda posesión.";
  const script = markdownToNarrationScript(body, plainNarrationText, { quoteCadence: true });
  assert.equal(script, "“Así queremos vernos.”\n<pause=0.3s>\n— Caleb Williams\n<pause=0.9s>\nPrimera posesión.\nSegunda posesión.");
  assert.doesNotThrow(() => normalizeNarrationScript(script));
});

test("generated English narration retains its established cadence", () => {
  const body = "> “This is how we want to look.”\n>\n> — **Caleb Williams**\n\nWilliams described the play.";
  assert.equal(
    markdownToNarrationScript(body, plainNarrationText),
    "“This is how we want to look.”\n— Caleb Williams\n<pause=0.7s>\nWilliams described the play.",
  );
});
