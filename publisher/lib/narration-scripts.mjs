import { createHash } from "node:crypto";

const PAUSE = /<pause=(0(?:\.\d+)?|[1-3](?:\.\d+)?)s>/gi;
const MARKDOWN = /(^|\n)\s{0,3}(?:#{1,6}\s|>|[-*+]\s)|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|`|\*\*|__|~~/m;
const MASTHEAD_LINE = /^\s*\*{0,2}(?:por|fecha|ubicaci[oó]n|by|date|location)\s*:\*{0,2}\s*/i;

export function stripEditorialMasthead(markdown) {
  const blocks = String(markdown ?? "").split(/(\n\s*\n)/);
  let removing = true;
  return blocks.filter((block) => {
    if (!block.trim()) return !removing;
    const lines = block.split(/\n/).filter((line) => line.trim());
    if (removing && lines.length && lines.every((line) => MASTHEAD_LINE.test(line.replace(/\\$/, "")))) return false;
    removing = false;
    return true;
  }).join("").replace(/^\s+/, "");
}

export function markdownToNarrationScript(markdown, cleanText, { quoteCadence = false } = {}) {
  const blocks = stripEditorialMasthead(markdown).split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const marker = /^(#{1,6}\s+|>\s*|(?:[-*+]\s+)|(?:\d+[.)]\s+))/.exec(block);
    const heading = marker?.[0]?.startsWith("#");
    const cleaned = cleanText(block.slice(marker?.[0]?.length ?? 0));
    const text = heading ? cleaned.replace(/^(?:[IVXLCDM]+|\d+)[.)]\s+/i, "") : cleaned;
    const quote = quoteCadence && marker?.[0]?.startsWith(">");
    const spoken = quote
      ? text.split(/\n+/).map((line) => line.trim()).filter(Boolean).join("\n<pause=0.3s>\n")
      : text;
    const pause = heading || quote ? "0.9" : "0.7";
    return `${spoken}${index === blocks.length - 1 ? "" : `\n<pause=${pause}s>`}`;
  }).join("\n").trim();
}

export function plainNarrationText(markdown) {
  return String(markdown ?? "")
    .replace(/🐻(?:\uFE0F)?⬇(?:\uFE0F)?/gu, "Bear Down")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
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
}

export function normalizeNarrationScript(value, field = "narration script") {
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length > 100_000) throw new Error(`${field} is too long`);
  const withoutPauses = normalized.replace(PAUSE, "");
  if (/<pause=/i.test(withoutPauses)) throw new Error(`${field} contains an invalid pause; use <pause=0.7s>`);
  if (MARKDOWN.test(withoutPauses)) throw new Error(`${field} must be plain text without Markdown`);
  return normalized.replace(PAUSE, (_, seconds) => `<pause=${Number(seconds).toFixed(1)}s>`);
}

export function normalizeNarrationCadence(value) {
  const lines = normalizeNarrationScript(value).split("\n");
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^—\s+\S/.test(line.trim())) {
      if (output.length && !/^<pause=(?:0(?:\.\d+)?|[1-3](?:\.\d+)?)s>$/i.test(output.at(-1).trim())) output.push("<pause=0.3s>");
      output.push(line);
      if (index + 1 < lines.length && /^<pause=/.test(lines[index + 1].trim())) {
        output.push("<pause=0.9s>");
        index += 1;
      } else if (index + 1 < lines.length) {
        output.push("<pause=0.9s>");
      }
      continue;
    }
    output.push(line);
  }
  return normalizeNarrationScript(output.join("\n"));
}

export function narrationSegmentsFromScript(script) {
  const normalized = normalizeNarrationScript(script);
  if (!normalized) return [];
  const segments = [];
  let start = 0;
  let sequence = 0;
  for (const match of normalized.matchAll(PAUSE)) {
    const text = normalized.slice(start, match.index).trim();
    if (text) {
      sequence += 1;
      segments.push({ id: `script-${String(sequence).padStart(3, "0")}`, kind: "narrative", text, pauseAfterMs: Math.round(Number(match[1]) * 1000) });
    }
    start = match.index + match[0].length;
  }
  const tail = normalized.slice(start).trim();
  if (tail) {
    sequence += 1;
    segments.push({ id: `script-${String(sequence).padStart(3, "0")}`, kind: "narrative", text: tail, pauseAfterMs: 0 });
  }
  if (!segments.length) throw new Error("narration script has no spoken text");
  if (segments.length > 250) throw new Error("narration script has too many segments");
  if (segments.some(({ text }) => text.length > 8_000)) throw new Error("a narration segment is too long");
  return segments;
}

export function narrationScriptRevision(value) {
  return createHash("sha256").update(normalizeNarrationScript(value)).digest("hex");
}
