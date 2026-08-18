function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderInline(source) {
  return escapeHtml(source)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
}

export function renderMarkdown(source) {
  return source.replaceAll("\r\n", "\n").split(/\n\s*\n/).filter((part) => part.trim()).map((part) => {
    const block = part.trim();
    const heading = /^(#{1,6})\s+/.exec(block);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      return `<h${level}>${renderInline(block.slice(heading[0].length))}</h${level}>`;
    }
    const lines = block.split("\n").map((line) => line.trim());
    if (lines.every((line) => /^>\s+/.test(line))) {
      return `<blockquote><p>${renderInline(lines.map((line) => line.replace(/^>\s+/, "")).join(" "))}</p></blockquote>`;
    }
    if (lines.every((line) => /^[-*+]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${renderInline(line.replace(/^[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    if (lines.every((line) => /^\d+\.\s+/.test(line))) {
      return `<ol>${lines.map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
    }
    return `<p>${renderInline(lines.join(" "))}</p>`;
  }).join("\n");
}

export function previewPage({ draft, translation, audio, locale, settings }) {
  if (translation.status !== "completed" || audio.status !== "completed") throw new Error("preview requires accepted translation and audio");
  if (translation.draftRevision !== draft.revision || audio.draftRevision !== draft.revision) throw new Error("preview outputs are stale");
  const english = locale === "en";
  const content = english ? translation.result : draft;
  const alternate = english ? "es" : "en";
  const promoHeading = english ? settings.promotion.headingEn : settings.promotion.heading;
  const promoLabel = english ? settings.promotion.labelEn : settings.promotion.label;
  const platforms = [
    ["YouTube", "https://www.youtube.com/@fanaticosos", "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"],
    ["Twitch", "https://www.twitch.tv/fanaticosos", "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"],
    ["Twitter", "https://x.com/fanaticososcom", "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"],
    ["Facebook", "https://www.facebook.com/fanaticosos", "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"],
    ["Discord", "https://discord.gg/dRKEhxvsjH", "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.082.118 18.107.14 18.122a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"],
  ].map(([name, url, path]) => `<a class="social-link" href="${url}" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>${name}</a>`).join("");
  const tags = draft.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join(" ");
  const imageCredit = draft.featuredImage.caption || draft.featuredImage.credit;
  const image = draft.featuredImage.path ? `<figure><img src="${escapeHtml(draft.featuredImage.path)}" alt="${escapeHtml(draft.featuredImage.alt || draft.title)}">${imageCredit ? `<figcaption>${escapeHtml(imageCredit)}</figcaption>` : ""}</figure>` : "";
  const player = `<audio controls preload="metadata" src="/api/drafts/${draft.articleId}/audio/${english ? "en" : "es"}"></audio>`;
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(content.title)} · Vista previa</title><link rel="stylesheet" href="/preview.css"></head>
<body><header><a class="brand" href="/">FANATICOSOS</a><span>Vista previa privada</span><div class="language-control"><small>${english ? "Language" : "Idioma"}</small><a href="/preview/${draft.articleId}/${alternate}">${english ? "← Versión en español" : "English version →"}</a></div></header>
<main><article><p class="eyebrow">${escapeHtml(draft.category)} · ${draft.season}</p><h1>${escapeHtml(content.title)}</h1><p class="description">${escapeHtml(content.description)}</p><p class="byline">${escapeHtml(settings.author.name)} · ${escapeHtml(settings.author.socialHandle)}</p>${image}${player}<div class="story">${renderMarkdown(content.body)}</div><div class="tags">${tags}</div><footer><strong>${escapeHtml(promoHeading)}</strong><p>${escapeHtml(promoLabel)}</p><nav class="social-bar" aria-label="${english ? "Social media" : "Redes sociales"}">${platforms}</nav></footer></article></main></body></html>`;
}
