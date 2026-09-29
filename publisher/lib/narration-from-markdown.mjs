export function narrationScriptFromMarkdown(markdown) {
  const clean = (value) => value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\\([\\`*{}\[\]()#+.!_>-])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const blocks = String(markdown ?? "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  while (blocks.length && blocks[0].split(/\n/).every((line) => /^\*{0,2}(?:por|fecha|ubicaci[oó]n|by|date|location)\s*:/i.test(line.replace(/\\$/, "")))) blocks.shift();
  return blocks.map((block, index) => {
    const marker = /^(#{1,6}\s+|>\s*|(?:[-*+]\s+)|(?:\d+[.)]\s+))/.exec(block);
    const heading = marker?.[0]?.startsWith("#");
    let text = clean(block.slice(marker?.[0]?.length ?? 0));
    if (heading) text = text.replace(/^(?:[IVXLCDM]+|\d+)[.)]\s+/i, "");
    return `${text}${index === blocks.length - 1 ? "" : `\n<pause=${heading ? "0.9" : "0.7"}s>`}`;
  }).join("\n");
}

export function synchronizeAutomaticSpanishNarration(existing, submitted) {
  if (submitted.body === existing.body) return submitted;
  const oldAutomaticNarration = narrationScriptFromMarkdown(existing.body);
  const existingNarrationWasAutomatic = !existing.narrationEs
    || existing.narrationEs === oldAutomaticNarration;
  const submittedNarrationWasUnchanged = submitted.narrationEs === existing.narrationEs
    || submitted.narrationEs === oldAutomaticNarration;
  if (!existingNarrationWasAutomatic || !submittedNarrationWasUnchanged) return submitted;
  return { ...submitted, narrationEs: narrationScriptFromMarkdown(submitted.body) };
}
