import { narrationScriptFromMarkdown } from "../public/narration-from-markdown.js";

export { narrationScriptFromMarkdown };

export function synchronizeAutomaticSpanishNarration(existing, submitted) {
  const oldAutomaticNarration = narrationScriptFromMarkdown(existing.body);
  if (submitted.body === existing.body) {
    if (!existing.narrationEs && submitted.narrationEs === oldAutomaticNarration) {
      return { ...submitted, narrationEs: "" };
    }
    return submitted;
  }
  const existingNarrationWasAutomatic = !existing.narrationEs
    || existing.narrationEs === oldAutomaticNarration;
  const submittedNarrationWasUnchanged = submitted.narrationEs === existing.narrationEs
    || submitted.narrationEs === oldAutomaticNarration;
  if (!existingNarrationWasAutomatic || !submittedNarrationWasUnchanged) return submitted;
  return { ...submitted, narrationEs: narrationScriptFromMarkdown(submitted.body) };
}
