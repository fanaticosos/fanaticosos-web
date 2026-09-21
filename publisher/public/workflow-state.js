export function deploymentStateForRevision(deployment, revision) {
  if (!deployment) return "none";
  if (deployment.draftRevision !== revision) return "outdated";
  if (deployment.status === "completed") return "published";
  if (["queued", "running"].includes(deployment.status)) return "publishing";
  if (deployment.status === "failed") return "failed";
  return "unknown";
}

export function canStartTranslation({ draft, translation, unsavedChanges = false }) {
  return Boolean(draft) && !unsavedChanges && !translation;
}

export function audioActionLabel(locale, ready) {
  const language = locale === "es" ? "español" : "inglés";
  return `${ready ? "Volver a generar" : "Generar"} audio en ${language}`;
}
