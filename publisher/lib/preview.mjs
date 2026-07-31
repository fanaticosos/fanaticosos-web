function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderMarkdown(source) {
  return source.split(/\n\s*\n/).filter((part) => part.trim()).map((part) => {
    const text = escapeHtml(part.trim()).replaceAll("\n", "<br>");
    const heading = /^(#{1,6})\s+/.exec(part.trim());
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      return `<h${level}>${text.slice(heading[0].length)}</h${level}>`;
    }
    if (/^>\s+/.test(part.trim())) return `<blockquote>${text.replace(/^&gt;\s+/, "")}</blockquote>`;
    if (/^[-*+]\s+/.test(part.trim())) return `<ul><li>${text.replace(/^[-*+]\s+/, "")}</li></ul>`;
    return `<p>${text}</p>`;
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
  const platforms = settings.promotion.platforms.map((item) => `<a href="${escapeHtml(item.url)}" rel="noopener noreferrer">${escapeHtml(item.name)}</a>`).join(" · ");
  const tags = draft.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join(" ");
  const image = draft.featuredImage.path ? `<figure><img src="${escapeHtml(draft.featuredImage.path)}" alt="${escapeHtml(draft.featuredImage.alt)}"><figcaption>${escapeHtml(draft.featuredImage.caption)} · ${escapeHtml(draft.featuredImage.credit)}</figcaption></figure>` : "";
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(content.title)} · Vista previa</title><link rel="stylesheet" href="/preview.css"></head>
<body><header><a class="brand" href="/">FANATICOSOS</a><span>Vista previa privada</span><a href="/preview/${draft.articleId}/${alternate}">${english ? "Español" : "English"}</a></header>
<main><article><p class="eyebrow">${escapeHtml(draft.category)} · ${draft.season}</p><h1>${escapeHtml(content.title)}</h1><p class="description">${escapeHtml(content.description)}</p><p class="byline">${escapeHtml(settings.author.name)} · ${escapeHtml(settings.author.socialHandle)}</p>${image}<audio controls preload="metadata" src="/api/drafts/${draft.articleId}/audio/${locale}"></audio><div class="story">${renderMarkdown(content.body)}</div><div class="tags">${tags}</div><footer><strong>${escapeHtml(promoHeading)}</strong><p>${escapeHtml(promoLabel)}</p><p>${platforms}</p></footer></article></main></body></html>`;
}
