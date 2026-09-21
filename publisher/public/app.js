import { generateSeoPreview } from "/seo.js";
import { audioActionLabel, canStartTranslation, deploymentStateForRevision } from "/workflow-state.js";

const form = document.querySelector("#article-form");
const list = document.querySelector("#draft-list");
const message = document.querySelector("#message");
const saveState = document.querySelector("#save-state");
const pageTitle = document.querySelector("#page-title");
const articleTitle = document.querySelector("#article-title");
let current = null;
let publisherSettings = null;
const dropZone = document.querySelector("#drop-zone");
const imageFile = document.querySelector("#image-file");
const imagePreview = document.querySelector("#image-preview");
const removeImage = document.querySelector("#remove-image");
const generateEnglish = document.querySelector("#generate-english");
const workflowState = document.querySelector("#workflow-state");
const englishResult = document.querySelector("#english-result");
const generateAudio = document.querySelector("#generate-audio");
const audioResult = document.querySelector("#audio-result");
const ttsPreflightPanel = document.querySelector("#tts-preflight");
const spanishAudioFile = document.querySelector("#spanish-audio-file");
const uploadSpanishAudio = document.querySelector("#upload-spanish-audio");
const generateSpanishAudio = document.querySelector("#generate-spanish-audio");
const spanishAudioStatus = document.querySelector("#spanish-audio-status");
const regenerateEnglishAudio = document.querySelector("#regenerate-english-audio");
const audiogramResult = document.querySelector("#audiogram-result");
const audiogramVideo = document.querySelector("#audiogram-video");
const audiogramStatus = document.querySelector("#audiogram-status");
const downloadAudiogram = document.querySelector("#download-audiogram");
const regenerateAudiogram = document.querySelector("#regenerate-audiogram");
const copyYoutube = document.querySelector("#copy-youtube");
const copyArticleLink = document.querySelector("#copy-article-link");
let audiogramMetadata = null;
const openPreview = document.querySelector("#open-preview");
const saveEnglish = document.querySelector("#save-english");
const retranslateEnglish = document.querySelector("#retranslate-english");
const englishReviewNote = document.querySelector("#english-review-note");
const prepareRelease = document.querySelector("#prepare-release");
const publishRelease = document.querySelector("#publish-release");
const dockSave = document.querySelector("#dock-save");
const dockTranslate = document.querySelector("#dock-translate");
const dockPreview = document.querySelector("#dock-preview");
const dockPublish = document.querySelector("#dock-publish");
const articleBody = document.querySelector("#article-body");
const bodyPreview = document.querySelector("#body-preview");
let translationTimer = null;
let translationClockTimer = null;
let audioTimer = null;
let releaseTimer = null;
let previewRequestedArticleId = null;
let audiogramTimer = null;
let deploymentTimer = null;
let markdownPreviewTimer = null;
let hasUnsavedChanges = false;
let translationNeedsConfirmation = false;

function markSaved() {
  hasUnsavedChanges = false;
}

function confirmDiscardChanges() {
  return !hasUnsavedChanges || window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?");
}

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

function syncWorkflowDock() {
  dockSave.disabled = document.querySelector("#save-draft").disabled;
  dockTranslate.disabled = translationNeedsConfirmation ? saveEnglish.disabled : generateEnglish.disabled;
  dockTranslate.textContent = translationNeedsConfirmation ? "Revisar inglés" : generateEnglish.textContent;
  dockPreview.disabled = openPreview.disabled;
  dockPublish.disabled = publishRelease.disabled;
  dockPublish.textContent = publishRelease.textContent;
}

for (const source of [document.querySelector("#save-draft"), generateEnglish, saveEnglish, openPreview, publishRelease]) {
  new MutationObserver(syncWorkflowDock).observe(source, { attributes: true, attributeFilter: ["disabled"], childList: true });
}
document.querySelectorAll("[data-scroll-target]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector(`#${button.dataset.scrollTarget}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
dockSave.addEventListener("click", () => form.requestSubmit());
dockTranslate.addEventListener("click", () => {
  if (translationNeedsConfirmation) englishResult.scrollIntoView({ behavior: "smooth", block: "start" });
  else generateEnglish.click();
});
retranslateEnglish.addEventListener("click", () => generateEnglish.click());
dockPreview.addEventListener("click", () => openPreview.click());
dockPublish.addEventListener("click", () => publishRelease.click());

function stopTranslationClock() {
  if (translationClockTimer) clearInterval(translationClockTimer);
  translationClockTimer = null;
}

function formatElapsed(startedAt) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return "tiempo desconocido";
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatLocalTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "hora desconocida";
}

function showSpanishAudioProgress(audio) {
  const job = audio.jobs?.es;
  if (!job) {
    spanishAudioStatus.textContent = "Audio en español: pendiente.";
    return;
  }
  if (job.status === "completed") {
    const finishedAt = job.result?.generatedAt ?? audio.updatedAt;
    spanishAudioStatus.textContent = `Audio en español: terminado a las ${formatLocalTime(finishedAt)} · nuevo audio listo para escuchar.`;
    return;
  }
  if (job.status === "failed") {
    spanishAudioStatus.textContent = `Audio en español: falló · ${job.error ?? audio.error ?? "revisa Actividad para ver el detalle"}`;
    return;
  }
  const phase = job.status === "queued" ? "en cola" : "generando";
  const progress = job.progress;
  const quota = progress?.quota;
  const quotaDetail = Number.isInteger(quota?.requiredCharacters)
    ? `${quota.requiredCharacters.toLocaleString("es-MX")} caracteres por comprar${Number.isInteger(quota.accountRemaining) ? ` · ${quota.accountRemaining.toLocaleString("es-MX")} disponibles en la cuenta` : ""}`
    : null;
  const detail = progress?.stage === "preflight"
    ? `verificando cuota de ElevenLabs${quotaDetail ? ` · ${quotaDetail}` : ""}`
    : progress?.stage === "assembling"
      ? `ensamblando ${progress.totalChunks} bloques`
      : Number.isInteger(progress?.completedChunks) && Number.isInteger(progress?.totalChunks)
        ? `bloque ${progress.completedChunks} de ${progress.totalChunks}`
        : null;
  spanishAudioStatus.textContent = `Audio en español: ${phase}${detail ? ` · ${detail}` : ""} · ${formatElapsed(job.createdAt ?? audio.updatedAt ?? audio.createdAt)} transcurridos · puedes cerrar esta página.`;
}

function showTranslationProgress(translation) {
  stopTranslationClock();
  const update = () => {
    const phase = translation.status === "queued" ? "En cola" : "Traduciendo al inglés";
    workflowState.textContent = `${phase} · ${formatElapsed(translation.createdAt)} transcurridos · puedes cerrar esta página.`;
  };
  update();
  translationClockTimer = setInterval(update, 1000);
}

async function renderBodyPreview() {
  const markdown = articleBody.value;
  if (!markdown.trim()) {
    bodyPreview.innerHTML = "<p>Comienza a escribir para ver el artículo.</p>";
    return;
  }
  try {
    const { html } = await request("/api/markdown-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    bodyPreview.innerHTML = html;
  } catch {
    bodyPreview.textContent = "La vista previa no pudo actualizarse.";
  }
}

function scheduleBodyPreview() {
  clearTimeout(markdownPreviewTimer);
  markdownPreviewTimer = setTimeout(renderBodyPreview, 180);
}

function formatSelection(action) {
  const start = articleBody.selectionStart;
  const end = articleBody.selectionEnd;
  const selected = articleBody.value.slice(start, end);
  const formats = {
    heading: ["## ", "Título de sección", ""],
    bold: ["**", "texto importante", "**"],
    quote: ["> ", "Cita", ""],
    list: ["- ", "Elemento de la lista", ""],
  };
  const [prefix, placeholder, suffix] = formats[action];
  articleBody.setRangeText(`${prefix}${selected || placeholder}${suffix}`, start, end, "end");
  articleBody.focus();
  articleBody.dispatchEvent(new Event("input", { bubbles: true }));
}

document.querySelectorAll("[data-markdown-action]").forEach((button) => {
  button.addEventListener("click", () => formatSelection(button.dataset.markdownAction));
});

function renderSeoPreview() {
  const ownerFields = fields();
  const seo = generateSeoPreview({ ...ownerFields, imagePath: ownerFields.featuredImage.path });
  document.querySelector("#seo-url").textContent = seo.canonicalUrl;
  document.querySelector("#seo-search-title").textContent = seo.title || "Título del artículo";
  document.querySelector("#seo-search-description").textContent = seo.description || "El resumen aparecerá aquí.";
  document.querySelector("#seo-social-title").textContent = seo.title || "Título del artículo";
  document.querySelector("#seo-social-description").textContent = seo.description || "El resumen aparecerá aquí.";
  document.querySelector("#seo-title-length").textContent = `${seo.lengths.title} caracteres`;
  document.querySelector("#seo-description-length").textContent = `${seo.lengths.description} caracteres`;
  document.querySelector("#seo-keywords").textContent = seo.keywords.join(" · ") || "Se generarán desde la categoría y etiquetas";
  const seoImage = document.querySelector("#seo-social-image");
  seoImage.src = seo.imagePath;
  seoImage.hidden = !seo.imagePath;
  const warnings = document.querySelector("#seo-warnings");
  warnings.replaceChildren(...(seo.warnings.length ? seo.warnings : ["SEO listo para publicar."]).map((warning) => {
    const item = document.createElement("li");
    item.textContent = warning;
    return item;
  }));
  warnings.classList.toggle("ready", !seo.warnings.length);
}

function fields() {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    description: data.get("description"),
    body: data.get("body"),
    category: data.get("category"),
    season: Number(data.get("season")),
    tags: data.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    status: "draft",
    narrationEs: data.get("narrationEs"),
    narrationEn: data.get("narrationEn"),
    featuredImage: {
      path: data.get("imagePath"),
      alt: data.get("imageAlt"),
      caption: "",
      credit: data.get("imageCredit"),
    },
  };
}

function narrationScriptFromMarkdown(markdown) {
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

function setFields(draft) {
  stopTranslationClock();
  if (translationTimer) clearInterval(translationTimer);
  translationTimer = null;
  if (audioTimer) clearInterval(audioTimer);
  audioTimer = null;
  if (releaseTimer) clearInterval(releaseTimer);
  releaseTimer = null;
  if (audiogramTimer) clearTimeout(audiogramTimer);
  audiogramTimer = null;
  if (deploymentTimer) clearInterval(deploymentTimer);
  deploymentTimer = null;
  form.elements.title.value = draft?.title ?? "";
  form.elements.description.value = draft?.description ?? "";
  form.elements.body.value = draft?.body ?? "";
  form.elements.category.value = draft?.category ?? publisherSettings?.defaultCategory ?? "";
  form.elements.season.value = draft?.season ?? publisherSettings?.defaultSeason ?? "";
  form.elements.tags.value = draft?.tags?.join(", ") ?? publisherSettings?.defaultTags?.join(", ") ?? "";
  form.elements.imagePath.value = draft?.featuredImage?.path ?? "";
  form.elements.imageAlt.value = draft?.featuredImage?.alt ?? "";
  form.elements.imageCredit.value = draft?.featuredImage?.caption || draft?.featuredImage?.credit || "";
  form.elements.narrationEs.value = draft?.narrationEs || narrationScriptFromMarkdown(draft?.body ?? "");
  form.elements.narrationEn.value = draft?.narrationEn ?? "";
  imagePreview.src = draft?.featuredImage?.path ?? "";
  imagePreview.hidden = !draft?.featuredImage?.path;
  removeImage.hidden = !draft?.featuredImage?.path;
  pageTitle.textContent = draft?.title || "Nuevo artículo";
  saveState.textContent = draft ? `Guardado · revisión ${draft.revision}` : "Sin guardar";
  generateEnglish.disabled = !canStartTranslation({ draft });
  translationNeedsConfirmation = false;
  workflowState.textContent = draft ? "Borrador guardado · puedes generar el audio español y crear la traducción cuando quieras." : "Guarda un borrador válido para comenzar.";
  englishResult.hidden = true;
  englishReviewNote.hidden = true;
  retranslateEnglish.hidden = true;
  saveEnglish.textContent = "Guardar corrección en inglés";
  audioResult.hidden = !draft;
  ttsPreflightPanel.hidden = !draft;
  audiogramResult.hidden = true;
  generateAudio.disabled = true;
  generateAudio.hidden = true;
  openPreview.disabled = true;
  prepareRelease.disabled = true;
  publishRelease.disabled = true;
  publishRelease.textContent = "Publicar";
  generateEnglish.textContent = "Crear traducción al inglés";
  generateSpanishAudio.disabled = !draft;
  generateSpanishAudio.textContent = audioActionLabel("es", false);
  regenerateEnglishAudio.disabled = true;
  regenerateEnglishAudio.textContent = audioActionLabel("en", false);
  document.querySelector("#english-title").value = "";
  document.querySelector("#english-description").value = "";
  document.querySelector("#english-body").value = "";
  document.querySelector("#audio-es").removeAttribute("src");
  document.querySelector("#audio-en").removeAttribute("src");
  document.querySelector("#audio-es-player").hidden = true;
  document.querySelector("#audio-en-player").hidden = true;
  spanishAudioFile.value = "";
  audiogramMetadata = null;
  renderSeoPreview();
  scheduleBodyPreview();
  markSaved();
}

async function refreshTtsPreflight() {
  if (!current) { ttsPreflightPanel.hidden = true; return null; }
  let preflight;
  try {
    ({ preflight } = await request(`/api/drafts/${current.articleId}/tts-preflight`));
  } catch (error) {
    ttsPreflightPanel.hidden = false;
    ttsPreflightPanel.className = "tts-preflight warning";
    document.querySelector("#tts-preflight-title").textContent = "La revisión de pronunciación no está disponible";
    document.querySelector("#tts-preflight-summary").textContent = `${error.message} El borrador sí permanece guardado.`;
    document.querySelector("#tts-preflight-unresolved").replaceChildren();
    document.querySelector("#tts-preflight-detected").replaceChildren();
    return null;
  }
  ttsPreflightPanel.hidden = false;
  ttsPreflightPanel.className = "tts-preflight ready";
  document.querySelector("#tts-preflight-title").textContent = preflight.status === "ready"
    ? "Nombres y lugares listos para TTS"
    : "Aviso de pronunciación en inglés";
  document.querySelector("#tts-preflight-summary").textContent = preflight.status === "ready"
    ? `${preflight.detected.length} entidades detectadas · ${preflight.rosterPlayers} jugadores NFL disponibles · temporada ${preflight.season}`
    : `${preflight.unresolved.length} nombre(s) o lugar(es) no están en el glosario. Esto no bloquea la traducción, el audio ni la publicación.`;
  const unresolved = document.querySelector("#tts-preflight-unresolved");
  unresolved.replaceChildren(...preflight.unresolved.map((name) => {
    const item = document.createElement("li"); item.textContent = name; return item;
  }));
  const detected = document.querySelector("#tts-preflight-detected");
  detected.replaceChildren(...preflight.detected.map((entity) => {
    const item = document.createElement("li");
    item.textContent = `${entity.written} · ${entity.category} · ${entity.language}`;
    return item;
  }));
  return preflight;
}

function applySettings(settings) {
  document.querySelector("#owner-name").textContent = settings.author.name;
  document.querySelector("#owner-social").textContent = settings.author.socialHandle;
  document.querySelector("#owner-timezone").textContent = settings.timezone;
}

async function refreshNotifications() {
  const { notifications } = await request("/api/notifications");
  const pending = notifications.filter((item) => !item.acknowledgedAt);
  const container = document.querySelector("#notification-list");
  const count = document.querySelector("#notification-count");
  const activity = document.querySelector(".activity-panel");
  const errorCount = pending.filter((item) => item.level === "error").length;
  document.querySelector("#acknowledge-all").hidden = pending.length < 2;
  count.textContent = !pending.length ? "Sin avisos" : errorCount ? `${errorCount} error${errorCount === 1 ? "" : "es"} · ${pending.length} en total` : `${pending.length} aviso${pending.length === 1 ? "" : "s"}`;
  activity.classList.toggle("has-error", errorCount > 0);
  if (!pending.length) {
    container.textContent = "No hay notificaciones pendientes.";
    return;
  }
  container.replaceChildren(...pending.map((item) => {
    const row = document.createElement("div");
    row.className = `notification ${item.level}`;
    const text = document.createElement("span");
    text.textContent = item.message;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reconocer";
    button.addEventListener("click", async () => {
      await request(`/api/notifications/${item.id}/acknowledge`, { method: "POST" });
      await refreshNotifications();
    });
    row.append(text, button);
    return row;
  }));
}

document.querySelector("#acknowledge-all").addEventListener("click", async () => {
  try {
    await request("/api/notifications/acknowledge-all", { method: "POST" });
    await refreshNotifications();
  } catch (error) {
    showError(error.message);
  }
});

async function uploadImage(file) {
  message.hidden = true;
  saveState.textContent = "Subiendo imagen…";
  try {
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "La imagen no pudo subirse.");
    form.elements.imagePath.value = value.upload.path;
    imagePreview.src = value.upload.path;
    imagePreview.hidden = false;
    removeImage.hidden = false;
    imageFile.value = "";
    hasUnsavedChanges = true;
    renderSeoPreview();
    saveState.textContent = "Imagen lista · guarda el borrador";
  } catch (error) {
    saveState.textContent = "Imagen no guardada";
    showError(error.message);
  }
}

function showError(text) {
  message.textContent = text;
  message.hidden = false;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") ?? "";
  let value;
  if (contentType.toLowerCase().includes("application/json")) {
    value = await response.json();
  } else {
    const text = await response.text();
    if (!response.ok) throw new Error(`El servidor respondió ${response.status}${text.trim() ? `: ${text.trim().slice(0, 180)}` : ""}`);
    throw new Error("El servidor devolvió una respuesta inesperada.");
  }
  if (!response.ok) throw new Error(value.error || `La operación no pudo completarse (${response.status}).`);
  return value;
}

async function refreshList() {
  const { drafts } = await request("/api/drafts");
  list.replaceChildren(...drafts.map((draft) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = draft.articleId === current?.articleId ? "draft selected" : "draft";
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = draft.title;
    button.querySelector("span").textContent = new Date(draft.updatedAt).toLocaleString("es-MX");
    button.addEventListener("click", async () => {
      if (draft.articleId !== current?.articleId && !confirmDiscardChanges()) return;
      await loadDraft(draft.articleId);
    });
    return button;
  }));
  if (!drafts.length) list.textContent = "Todavía no hay borradores.";
}

async function loadDraft(articleId) {
  current = (await request(`/api/drafts/${articleId}`)).draft;
  window.history.replaceState(null, "", `/?draft=${encodeURIComponent(articleId)}`);
  setFields(current);
  await refreshTtsPreflight();
  message.hidden = true;
  await refreshList();
  const status = await pollTranslation();
  if (["queued", "running"].includes(status)) translationTimer = setInterval(pollTranslation, 5000);
  const audioStatus = await pollAudio();
  if (["queued", "running"].includes(audioStatus) && !audioTimer) audioTimer = setInterval(pollAudio, 5000);
  const deploymentStatus = await pollDeployment();
  if (["queued", "running"].includes(deploymentStatus) && !deploymentTimer) deploymentTimer = setInterval(pollDeployment, 4000);
}

form.addEventListener("input", (event) => {
  hasUnsavedChanges = true;
  if (event.target === articleBody) scheduleBodyPreview();
  if (event.target === form.elements.narrationEs || event.target === form.elements.narrationEn) {
    const language = event.target === form.elements.narrationEs ? "español" : "inglés";
    saveState.textContent = "Cambios sin guardar";
    workflowState.textContent = `Guion ${language} sin guardar · solo se actualizará su propio audio.`;
    generateSpanishAudio.disabled = true;
    regenerateEnglishAudio.disabled = true;
    generateEnglish.disabled = true;
    openPreview.disabled = true;
    prepareRelease.disabled = true;
    publishRelease.disabled = true;
    message.hidden = true;
    return;
  }
  if (event.target.closest("#english-result")) {
    workflowState.textContent = "Corrección en inglés sin guardar.";
    generateAudio.disabled = true;
    openPreview.disabled = true;
    prepareRelease.disabled = true;
    audioResult.hidden = true;
    audiogramResult.hidden = true;
    return;
  }
  saveState.textContent = "Cambios sin guardar";
  generateEnglish.disabled = true;
  generateAudio.disabled = true;
  openPreview.disabled = true;
  prepareRelease.disabled = true;
  publishRelease.disabled = true;
  message.hidden = true;
  renderSeoPreview();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  saveState.textContent = "Guardando…";
  try {
    if (current) {
      current = (await request(`/api/drafts/${current.articleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision, draft: fields() }),
      })).draft;
    } else {
      current = (await request("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields()),
      })).draft;
    }
    setFields(current);
    markSaved();
  } catch (error) {
    saveState.textContent = "No guardado";
    showError(error.message);
    return;
  }
  // The save above is authoritative. Follow-up status panels are useful but
  // must never turn a successful save into a false "No guardado" result.
  const refreshes = await Promise.allSettled([refreshTtsPreflight(), refreshList(), pollTranslation(), pollAudio()]);
  const [translationRefresh, audioRefresh] = [refreshes[2], refreshes[3]];
  if (translationRefresh.status === "fulfilled" && ["queued", "running"].includes(translationRefresh.value) && !translationTimer) translationTimer = setInterval(pollTranslation, 5000);
  if (audioRefresh.status === "fulfilled" && ["queued", "running"].includes(audioRefresh.value) && !audioTimer) audioTimer = setInterval(pollAudio, 5000);
  const failed = refreshes.find((result) => result.status === "rejected");
  if (failed) showError(`El borrador quedó guardado, pero no se pudo actualizar todo el estado: ${failed.reason?.message ?? "error desconocido"}`);
});

async function pollTranslation() {
  if (!current) return null;
  const articleId = current.articleId;
  try {
    const { translation } = await request(`/api/drafts/${articleId}/translation`);
    if (current?.articleId !== articleId) return null;
    if (!translation) {
      translationNeedsConfirmation = false;
      generateEnglish.disabled = !canStartTranslation({ draft: current, translation, unsavedChanges: hasUnsavedChanges });
      generateEnglish.textContent = "Crear traducción al inglés";
      return null;
    }
    if (["queued", "running"].includes(translation.status)) showTranslationProgress(translation);
    if (translation.status === "completed") {
      translationNeedsConfirmation = false;
      englishReviewNote.hidden = true;
      retranslateEnglish.hidden = true;
      saveEnglish.textContent = "Guardar corrección en inglés";
      stopTranslationClock();
      workflowState.textContent = "Etapa 2 · traducción lista; revisa el guion inglés y genera únicamente su audio.";
      clearInterval(translationTimer);
      translationTimer = null;
      document.querySelector("#english-title").value = translation.result.title;
      document.querySelector("#english-description").value = translation.result.description;
      document.querySelector("#english-body").value = translation.result.body;
      if (!form.elements.narrationEn.value) form.elements.narrationEn.value = translation.result.narrationScript ?? "";
      englishResult.hidden = false;
      audioResult.hidden = false;
      generateEnglish.disabled = true;
      generateEnglish.textContent = "Traducción creada";
      await refreshNotifications();
      generateAudio.hidden = true;
      generateAudio.disabled = true;
      regenerateEnglishAudio.disabled = false;
      const audioStatus = await pollAudio();
      if (!audioStatus) {
        generateAudio.hidden = true;
        generateAudio.disabled = true;
      }
      if (["queued", "running"].includes(audioStatus) && !audioTimer) audioTimer = setInterval(pollAudio, 5000);
    } else if (translation.status === "stale") {
      translationNeedsConfirmation = true;
      stopTranslationClock();
      workflowState.textContent = "Para habilitar Vista previa: revisa y confirma el inglés existente o crea una nueva traducción. El audio español se conserva.";
      document.querySelector("#english-title").value = translation.result?.title ?? "";
      document.querySelector("#english-description").value = translation.result?.description ?? "";
      document.querySelector("#english-body").value = translation.result?.body ?? "";
      if (!form.elements.narrationEn.value) form.elements.narrationEn.value = translation.result?.narrationScript ?? narrationScriptFromMarkdown(translation.result?.body ?? "");
      englishResult.hidden = false;
      englishReviewNote.hidden = false;
      retranslateEnglish.hidden = false;
      saveEnglish.textContent = "Confirmar inglés revisado";
      audioResult.hidden = false;
      generateSpanishAudio.disabled = true;
      regenerateEnglishAudio.disabled = true;
      audiogramResult.hidden = true;
      generateEnglish.disabled = false;
      generateEnglish.textContent = "Crear nueva traducción al inglés";
      syncWorkflowDock();
      openPreview.disabled = true;
      publishRelease.disabled = true;
    } else if (translation.status === "failed") {
      translationNeedsConfirmation = false;
      stopTranslationClock();
      workflowState.textContent = "La traducción se detuvo.";
      clearInterval(translationTimer);
      translationTimer = null;
      generateEnglish.disabled = false;
      generateEnglish.textContent = "Reintentar traducción";
      showError(translation.error || "La traducción no pasó la validación.");
      await refreshNotifications();
    }
    return translation.status;
  } catch (error) {
    if (!/not found/i.test(error.message)) showError(error.message);
    return null;
  }
}

generateEnglish.addEventListener("click", async () => {
  if (!current) return;
  message.hidden = true;
  generateEnglish.disabled = true;
  workflowState.textContent = "Enviando traducción…";
  try {
    await request(`/api/drafts/${current.articleId}/translation`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision, workflow: "manual" }),
    });
    workflowState.textContent = "Traducción iniciada. Al terminar podrás revisar el texto y confirmar los audios.";
    await refreshNotifications();
    const status = await pollTranslation();
    if (["queued", "running"].includes(status)) translationTimer = setInterval(pollTranslation, 5000);
  } catch (error) {
    generateEnglish.disabled = false;
    workflowState.textContent = "No se inició la traducción.";
    showError(error.message);
  }
});

async function pollAudio() {
  if (!current) return null;
  const articleId = current.articleId;
  try {
    const { audio } = await request(`/api/drafts/${articleId}/audio`);
    if (current?.articleId !== articleId) return null;
    if (!audio) return null;
    audioResult.hidden = false;
    showSpanishAudioProgress(audio);
    const spanishReady = audio.jobs?.es?.status === "completed";
    const englishReady = audio.jobs?.en?.status === "completed";
    generateSpanishAudio.textContent = audioActionLabel("es", spanishReady);
    regenerateEnglishAudio.textContent = audioActionLabel("en", englishReady);
    document.querySelector("#audio-es-player").hidden = !spanishReady;
    document.querySelector("#audio-en-player").hidden = !englishReady;
    const spanishPlayer = document.querySelector("#audio-es");
    const englishPlayer = document.querySelector("#audio-en");
    if (spanishReady) {
      const source = `/api/drafts/${articleId}/audio/es?v=${encodeURIComponent(audio.jobs.es.jobId)}`;
      if (spanishPlayer.getAttribute("src") !== source) spanishPlayer.src = source;
      if (audio.jobs.es.result?.engine !== "ElevenLabs") spanishAudioStatus.textContent = `Audio en español: MP3 cargado y validado a las ${formatLocalTime(audio.updatedAt)}.`;
    }
    if (englishReady) {
      const source = `/api/drafts/${articleId}/audio/en?v=${encodeURIComponent(audio.jobs.en.jobId)}`;
      if (englishPlayer.getAttribute("src") !== source) englishPlayer.src = source;
    }
    if (audio.status === "completed") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      workflowState.textContent = "Los audios en español e inglés están listos.";
      pollAudiogram();
      uploadSpanishAudio.disabled = false;
      generateSpanishAudio.disabled = false;
      regenerateEnglishAudio.disabled = false;
      generateAudio.disabled = false;
      generateAudio.hidden = true;
      openPreview.disabled = false;
      prepareRelease.disabled = false;
      publishRelease.disabled = true;
      generateEnglish.disabled = true;
      await refreshNotifications();
      const releaseStatus = await pollRelease();
      if (["queued", "running"].includes(releaseStatus) && !releaseTimer) releaseTimer = setInterval(pollRelease, 5000);
    } else if (audio.status === "stale") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      const staleLocales = audio.staleLocales ?? ["es", "en"];
      const bothStale = staleLocales.includes("es") && staleLocales.includes("en");
      workflowState.textContent = translationNeedsConfirmation
        ? "Vista previa bloqueada: revisa y confirma el inglés actual antes de continuar. El audio español se conserva."
        : bothStale
        ? "La política o los guiones cambiaron · regenera cada idioma afectado o ambos audios."
        : `El audio en ${staleLocales[0] === "es" ? "español" : "inglés"} cambió · regenera solamente ese audio.`;
      generateAudio.hidden = !bothStale;
      generateAudio.disabled = !bothStale;
      generateSpanishAudio.disabled = !staleLocales.includes("es");
      regenerateEnglishAudio.disabled = translationNeedsConfirmation || !staleLocales.includes("en");
      openPreview.disabled = true;
      prepareRelease.disabled = true;
      publishRelease.disabled = true;
    } else if (audio.status === "awaiting-upload") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      workflowState.textContent = "Audio en inglés listo · genera el audio en español.";
      spanishAudioStatus.textContent = "Pulsa Generar audio en español para completar la vista previa.";
      uploadSpanishAudio.disabled = false;
      generateSpanishAudio.disabled = false;
      regenerateEnglishAudio.disabled = false;
    } else if (audio.status === "awaiting-english") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      workflowState.textContent = "Audio español listo · continúa con la traducción y después genera el audio inglés.";
      spanishAudioStatus.textContent = "Audio en español: listo y conservado.";
      uploadSpanishAudio.disabled = false;
      generateSpanishAudio.disabled = false;
      regenerateEnglishAudio.disabled = true;
      generateEnglish.disabled = false;
    } else if (audio.status === "failed") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      generateAudio.disabled = false;
      generateAudio.hidden = false;
      showError(audio.error || "La generación de audio no pasó la validación.");
      await refreshNotifications();
    } else {
      const activeLocale = audio.regeneratedLocale === "es" ? "el audio en español" : audio.regeneratedLocale === "en" ? "el audio en inglés" : "los audios";
      workflowState.textContent = audio.status === "queued" ? `${activeLocale} en cola…` : `Generando ${activeLocale}…`;
      uploadSpanishAudio.disabled = false;
      generateSpanishAudio.disabled = true;
      regenerateEnglishAudio.disabled = true;
      generateAudio.hidden = false;
      generateAudio.disabled = true;
    }
    return audio.status;
  } catch (error) {
    if (!/not found/i.test(error.message)) showError(error.message);
    return null;
  }
}

async function pollAudiogram() {
  if (!current) return;
  const articleId = current.articleId;
  if (audiogramTimer) clearTimeout(audiogramTimer);
  audiogramTimer = null;
  try {
    const { audiogram } = await request(`/api/drafts/${articleId}/audiogram`);
    if (current?.articleId !== articleId) return null;
    if (!audiogram) return null;
    audiogramResult.hidden = false;
    if (audiogram.status === "completed") {
      audiogramMetadata = audiogram.result;
      audiogramStatus.textContent = "Video completo listo para revisar y descargar.";
      audiogramVideo.src = `/api/drafts/${articleId}/audiogram/video?v=${encodeURIComponent(audiogram.updatedAt)}`;
      audiogramVideo.hidden = false; downloadAudiogram.hidden = false; copyYoutube.hidden = false; copyArticleLink.hidden = false;
      downloadAudiogram.href = `/api/drafts/${articleId}/audiogram/video?download=1`;
      downloadAudiogram.download = `${current.title || "fanaticosos-blog"}.mp4`;
    } else if (audiogram.status === "stale") {
      audiogramMetadata = null;
      audiogramStatus.textContent = "La imagen o el artículo cambió · crea un video actualizado antes de descargarlo.";
      audiogramVideo.hidden = true;
      downloadAudiogram.hidden = true;
      copyYoutube.hidden = true;
      copyArticleLink.hidden = true;
    } else {
      audiogramStatus.textContent = audiogram.status === "failed" ? audiogram.error : "Preparando video completo para YouTube…";
      if (["queued", "running"].includes(audiogram.status)) audiogramTimer = setTimeout(pollAudiogram, 5000);
    }
  } catch (error) { if (!/not found/i.test(error.message)) audiogramStatus.textContent = error.message; }
}

copyYoutube.addEventListener("click", async () => { if (audiogramMetadata) await navigator.clipboard.writeText(`${audiogramMetadata.youtubeTitle}\n\n${audiogramMetadata.youtubeDescription}`); });
copyArticleLink.addEventListener("click", async () => { if (audiogramMetadata) await navigator.clipboard.writeText(audiogramMetadata.canonicalUrl); });
regenerateAudiogram.addEventListener("click", async () => {
  if (!current) return;
  regenerateAudiogram.disabled = true;
  try {
    await request(`/api/drafts/${current.articleId}/audiogram`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: current.revision }) });
    audiogramResult.hidden = false; audiogramStatus.textContent = "Preparando video completo para YouTube…"; setTimeout(pollAudiogram, 2000);
  } catch (error) { showError(error.message); }
  finally { regenerateAudiogram.disabled = false; }
});

generateAudio.addEventListener("click", async () => {
  if (!current) return;
  generateAudio.disabled = true;
  workflowState.textContent = "Enviando audios…";
  try {
    await request(`/api/drafts/${current.articleId}/audio`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision, confirmReviewed: true }),
    });
    await refreshNotifications();
    const audioStatus = await pollAudio();
    if (["queued", "running"].includes(audioStatus)) audioTimer = setInterval(pollAudio, 5000);
  } catch (error) {
    generateAudio.disabled = false;
    workflowState.textContent = "No se inició la generación de audio.";
    showError(error.message);
  }
});

async function regenerateLocaleAudio(locale) {
  if (!current) return;
  const button = locale === "es" ? generateSpanishAudio : regenerateEnglishAudio;
  const language = locale === "es" ? "español" : "inglés";
  button.disabled = true;
  message.hidden = true;
  workflowState.textContent = `Regenerando únicamente el audio en ${language}…`;
  if (locale === "es") spanishAudioStatus.textContent = "Audio en español: enviando solicitud…";
  try {
    await request(`/api/drafts/${current.articleId}/audio/${locale}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision }),
    });
    await refreshNotifications();
    const audioStatus = await pollAudio();
    if (["queued", "running"].includes(audioStatus)) audioTimer = setInterval(pollAudio, 5000);
  } catch (error) {
    button.disabled = false;
    workflowState.textContent = `No se inició la regeneración del audio en ${language}.`;
    showError(error.message);
  }
}

regenerateEnglishAudio.addEventListener("click", () => regenerateLocaleAudio("en"));
generateSpanishAudio.addEventListener("click", () => regenerateLocaleAudio("es"));

uploadSpanishAudio.addEventListener("click", async () => {
  if (!current || !spanishAudioFile.files?.[0]) return showError("Selecciona primero tu archivo MP3 en español.");
  const file = spanishAudioFile.files[0];
  if (!/\.mp3$/i.test(file.name)) return showError("El archivo debe ser MP3.");
  uploadSpanishAudio.disabled = true;
  spanishAudioStatus.textContent = `Subiendo ${file.name}…`;
  try {
    await request(`/api/uploads?articleId=${encodeURIComponent(current.articleId)}&revision=${current.revision}`, { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: file });
    spanishAudioStatus.textContent = "MP3 validado. Preparando el audiograma y la vista previa…";
    await pollAudio();
  } catch (error) { spanishAudioStatus.textContent = `No se pudo cargar el MP3: ${error.message}`; showError(error.message); }
  finally { uploadSpanishAudio.disabled = false; }
});

openPreview.addEventListener("click", async () => {
  if (!current) return;
  previewRequestedArticleId = current.articleId;
  openPreview.disabled = true;
  publishRelease.disabled = true;
  workflowState.textContent = "Preparando y validando la vista previa privada…";
  try {
    const { release } = await request(`/api/drafts/${current.articleId}/release`);
    let status = release?.status ?? null;
    if (!release || ["failed", "stale"].includes(release.status)) {
      await request(`/api/drafts/${current.articleId}/release`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: current.revision }),
      });
      status = "queued";
    }
    const releaseStatus = await pollRelease();
    if (["queued", "running"].includes(releaseStatus || status) && !releaseTimer) releaseTimer = setInterval(pollRelease, 5000);
  } catch (error) {
    previewRequestedArticleId = null;
    showError(error.message);
  }
});

saveEnglish.addEventListener("click", async () => {
  if (!current) return;
  saveEnglish.disabled = true;
  try {
    await request(`/api/drafts/${current.articleId}/translation`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision, result: {
        title: document.querySelector("#english-title").value,
        description: document.querySelector("#english-description").value,
        body: document.querySelector("#english-body").value,
        narrationScript: form.elements.narrationEn.value,
      } }),
    });
    markSaved();
    workflowState.textContent = "Corrección en inglés guardada · regenera los audios.";
    openPreview.disabled = true;
    prepareRelease.disabled = true;
    audiogramResult.hidden = true;
    await pollTranslation();
    await refreshNotifications();
  } catch (error) {
    showError(error.message);
  } finally {
    saveEnglish.disabled = false;
  }
});

async function pollRelease() {
  if (!current) return null;
  const articleId = current.articleId;
  try {
    const { release } = await request(`/api/drafts/${articleId}/release`);
    if (current?.articleId !== articleId) return null;
    if (!release) return null;
    if (release.status === "completed") {
      if (releaseTimer) clearInterval(releaseTimer);
      releaseTimer = null;
      workflowState.textContent = "Compilación privada validada · lista para publicar.";
      prepareRelease.disabled = false;
      publishRelease.disabled = false;
      generateEnglish.disabled = true;
      await refreshNotifications();
      if (previewRequestedArticleId === articleId) {
        previewRequestedArticleId = null;
        window.location.assign(`/preview/${articleId}/es`);
      }
    } else if (release.status === "failed") {
      if (releaseTimer) clearInterval(releaseTimer);
      releaseTimer = null;
      previewRequestedArticleId = null;
      openPreview.disabled = false;
      prepareRelease.disabled = false;
      showError(release.error || "La compilación privada no pasó la validación.");
      await refreshNotifications();
    } else if (release.status === "stale") {
      if (releaseTimer) clearInterval(releaseTimer);
      releaseTimer = null;
      previewRequestedArticleId = null;
      openPreview.disabled = false;
      workflowState.textContent = "Los audios cambiaron · prepara una nueva vista previa antes de publicar.";
      prepareRelease.disabled = false;
      publishRelease.disabled = true;
    } else {
      workflowState.textContent = release.status === "queued" ? "Compilación privada en cola…" : "Validando compilación privada…";
    }
    return release.status;
  } catch (error) {
    if (!/not found/i.test(error.message)) showError(error.message);
    return null;
  }
}

prepareRelease.addEventListener("click", async () => {
  if (!current) return;
  prepareRelease.disabled = true;
  try {
    await request(`/api/drafts/${current.articleId}/release`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision }),
    });
    await refreshNotifications();
    const releaseStatus = await pollRelease();
    if (["queued", "running"].includes(releaseStatus)) releaseTimer = setInterval(pollRelease, 5000);
  } catch (error) {
    prepareRelease.disabled = false;
    showError(error.message);
  }
});

async function pollDeployment() {
  if (!current) return null;
  const articleId = current.articleId;
  try {
    const { deployment } = await request(`/api/drafts/${articleId}/publish`);
    if (current?.articleId !== articleId || !deployment) return null;
    const deploymentState = deploymentStateForRevision(deployment, current.revision);
    if (deploymentState === "outdated") return "outdated";
    if (deploymentState === "published") {
      if (deploymentTimer) clearInterval(deploymentTimer);
      deploymentTimer = null;
      publishRelease.disabled = true;
      publishRelease.textContent = "Publicado";
      workflowState.textContent = "Publicado y verificado en fanaticosos.com.";
    } else if (deploymentState === "failed") {
      if (deploymentTimer) clearInterval(deploymentTimer);
      deploymentTimer = null;
      publishRelease.disabled = false;
      publishRelease.textContent = "Reintentar publicación";
      showError(deployment.error || "La publicación no pudo completarse.");
    } else {
      publishRelease.disabled = true;
      publishRelease.textContent = "Publicando…";
      workflowState.textContent = "Publicación en curso… el sitio actual permanece activo durante la validación.";
    }
    return deployment.status;
  } catch (error) {
    if (!/not found/i.test(error.message)) showError(error.message);
    return null;
  }
}

publishRelease.addEventListener("click", async () => {
  if (!current) return;
  publishRelease.disabled = true;
  workflowState.textContent = "Solicitando publicación…";
  try {
    await request(`/api/drafts/${current.articleId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: current.revision }) });
    workflowState.textContent = "Publicación iniciada… el sitio actual permanece activo durante la validación.";
    if (deploymentTimer) clearInterval(deploymentTimer);
    const deploymentStatus = await pollDeployment();
    if (["queued", "running"].includes(deploymentStatus) && !deploymentTimer) deploymentTimer = setInterval(pollDeployment, 4000);
  } catch (error) { publishRelease.disabled = false; showError(error.message); }
});

document.querySelector("#new-draft").addEventListener("click", () => {
  if (!confirmDiscardChanges()) return;
  current = null;
  window.history.replaceState(null, "", "/");
  form.reset();
  setFields(null);
  message.hidden = true;
  refreshList().catch((error) => showError(error.message));
  articleTitle.scrollIntoView({ behavior: "smooth", block: "center" });
  articleTitle.focus({ preventScroll: true });
});

imageFile.addEventListener("change", () => {
  if (imageFile.files[0]) uploadImage(imageFile.files[0]);
});
removeImage.addEventListener("click", () => {
  hasUnsavedChanges = true;
  form.elements.imagePath.value = "";
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
  removeImage.hidden = true;
  saveState.textContent = "Imagen quitada · guarda el borrador";
  generateEnglish.disabled = true;
  openPreview.disabled = true;
  publishRelease.disabled = true;
  renderSeoPreview();
});
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", (event) => {
  if (event.dataTransfer.files[0]) uploadImage(event.dataTransfer.files[0]);
});

async function initialize() {
  const publisherResponse = await request("/api/settings");
  publisherSettings = publisherResponse.settings;
  applySettings(publisherSettings);
  setFields(null);
  await Promise.all([refreshList(), refreshNotifications()]);
  const requestedDraft = new URLSearchParams(window.location.search).get("draft");
  if (requestedDraft && /^[0-9a-f-]{36}$/.test(requestedDraft)) await loadDraft(requestedDraft);
}

initialize().catch((error) => showError(error.message));
