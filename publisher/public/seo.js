export function seoSlug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateSeoPreview({ title, description, category, season, tags = [], imagePath = "" }) {
  const cleanTitle = String(title ?? "").trim().replace(/\s+/g, " ");
  const cleanDescription = String(description ?? "").trim().replace(/\s+/g, " ");
  const slug = seoSlug(cleanTitle) || "nuevo-articulo";
  const canonicalUrl = `https://fanaticosos.com/blog/${slug}/`;
  const keywords = [...new Set([category, String(season || ""), ...tags]
    .map((item) => String(item ?? "").replace(/^#/, "").trim())
    .filter(Boolean))];
  const warnings = [];

  if (!cleanTitle) warnings.push("Agrega un título para generar la vista previa.");
  else if (cleanTitle.length < 30) warnings.push("El título es breve; confirma que explique el tema principal.");
  else if (cleanTitle.length > 65) warnings.push("El título podría cortarse en algunos resultados de búsqueda.");

  if (!cleanDescription) warnings.push("Agrega un resumen para buscadores y redes.");
  else if (cleanDescription.length < 70) warnings.push("El resumen es breve; considera añadir más contexto.");
  else if (cleanDescription.length > 160) warnings.push("El resumen podría cortarse en algunos resultados.");

  if (!imagePath) warnings.push("Sin imagen destacada: el artículo puede compartirse, pero tendrá menor impacto visual.");

  return {
    title: cleanTitle,
    browserTitle: cleanTitle ? `${cleanTitle} — FanaticOSOS` : "FanaticOSOS",
    description: cleanDescription,
    slug,
    canonicalUrl,
    keywords,
    imagePath,
    warnings,
    lengths: { title: cleanTitle.length, description: cleanDescription.length },
  };
}
