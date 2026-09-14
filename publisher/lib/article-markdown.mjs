export function normalizeArticleMarkdown(source) {
  return String(source ?? "").replaceAll("\r\n", "\n").split("\n").map((line) => {
    const ordered = /^(\s*)(\d+[.)]\s+)(?:\d+[.)]\s+)(.*)$/.exec(line);
    if (ordered) return `${ordered[1]}${ordered[2]}${ordered[3]}`;
    const unordered = /^(\s*)([-*+]\s+)(?:[-*+]\s+)(.*)$/.exec(line);
    if (unordered) return `${unordered[1]}${unordered[2]}${unordered[3]}`;
    return line;
  }).join("\n");
}
