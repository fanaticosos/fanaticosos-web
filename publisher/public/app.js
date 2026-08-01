import { generateSeoPreview } from "/seo.js";

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
const generateEnglish = document.querySelector("#generate-english");
const workflowState = document.querySelector("#workflow-state");
const englishResult = document.querySelector("#english-result");
const generateAudio = document.querySelector("#generate-audio");
const audioResult = document.querySelector("#audio-result");
const regenerateSpanishAudio = document.querySelector("#regenerate-spanish-audio");
const regenerateEnglishAudio = document.querySelector("#regenerate-english-audio");
const openPreview = document.querySelector("#open-preview");
const saveEnglish = document.querySelector("#save-english");
const prepareRelease = document.querySelector("#prepare-release");
const publishRelease = document.querySelector("#publish-release");
const musicForm = document.querySelector("#music-form");
const musicState = document.querySelector("#music-state");
const articleBody = document.querySelector("#article-body");
const bodyPreview = document.querySelector("#body-preview");
let translationTimer = null;
let audioTimer = null;
let releaseTimer = null;
let markdownPreviewTimer = null;

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

function renderMusic(settings) {
  const song = settings.music.weeklySong;
  document.querySelector("#weekly-song-url").value = settings.music.weeklySongUrl;
  document.querySelector("#music-summary").textContent = `${song.title} · ${song.artist}`;
  document.querySelector("#music-cover").src = song.coverUrl;
  document.querySelector("#music-cover").alt = `Portada de ${song.album || song.title}`;
  document.querySelector("#music-title").textContent = song.title;
  document.querySelector("#music-artist").textContent = `${song.artist}${song.album ? ` · ${song.album}` : ""}`;
  document.querySelector("#music-audio").src = song.streamUrl;
  document.querySelector("#music-preview").hidden = false;
}

function renderSeoPreview() {
  const seo = generateSeoPreview(fields());
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
    featuredImage: {
      path: data.get("imagePath"),
      alt: data.get("imageAlt"),
      caption: "",
      credit: data.get("imageCredit"),
    },
  };
}

function setFields(draft) {
  if (translationTimer) clearInterval(translationTimer);
  translationTimer = null;
  if (audioTimer) clearInterval(audioTimer);
  audioTimer = null;
  if (releaseTimer) clearInterval(releaseTimer);
  releaseTimer = null;
  form.elements.title.value = draft?.title ?? "";
  form.elements.description.value = draft?.description ?? "";
  form.elements.body.value = draft?.body ?? "";
  form.elements.category.value = draft?.category ?? publisherSettings?.defaultCategory ?? "";
  form.elements.season.value = draft?.season ?? publisherSettings?.defaultSeason ?? "";
  form.elements.tags.value = draft?.tags?.join(", ") ?? publisherSettings?.defaultTags?.join(", ") ?? "";
  form.elements.imagePath.value = draft?.featuredImage?.path ?? "";
  form.elements.imageAlt.value = draft?.featuredImage?.alt ?? "";
  form.elements.imageCredit.value = draft?.featuredImage?.caption || draft?.featuredImage?.credit || "";
  imagePreview.src = draft?.featuredImage?.path ?? "";
  imagePreview.hidden = !draft?.featuredImage?.path;
  pageTitle.textContent = draft?.title || "Nuevo artículo";
  saveState.textContent = draft ? `Guardado · revisión ${draft.revision}` : "Sin guardar";
  generateEnglish.disabled = !draft;
  workflowState.textContent = draft ? "Listo para preparar traducción, audios y vista previa con un solo clic." : "Guarda un borrador válido para comenzar.";
  englishResult.hidden = true;
  audioResult.hidden = true;
  generateAudio.disabled = true;
  openPreview.disabled = true;
  prepareRelease.disabled = true;
  renderSeoPreview();
  scheduleBodyPreview();
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
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "La operación no pudo completarse.");
  return value;
}

musicForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#save-music");
  button.disabled = true;
  musicState.textContent = "Verificando canción…";
  message.hidden = true;
  try {
    const { settings } = await request("/api/music", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeklySongUrl: document.querySelector("#weekly-song-url").value.trim() }),
    });
    renderMusic(settings);
    musicState.textContent = "Publicando en la página principal…";
    const started = Date.now();
    let completed = false;
    while (Date.now() - started < 10 * 60 * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const { publication } = await request("/api/music");
      if (publication?.status === "completed") { musicState.textContent = "Publicada en la página principal"; completed = true; break; }
      if (publication?.status === "failed") throw new Error(publication.error || "La publicación de música no pudo completarse.");
    }
    if (!completed) throw new Error("La publicación sigue en curso. Puedes cerrar esta pantalla; el proceso continuará automáticamente.");
  } catch (error) {
    musicState.textContent = "No guardada";
    showError(error.message);
  } finally {
    button.disabled = false;
  }
});

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
      current = (await request(`/api/drafts/${draft.articleId}`)).draft;
      setFields(current);
      message.hidden = true;
      await refreshList();
      const status = await pollTranslation();
      if (["queued", "running"].includes(status)) translationTimer = setInterval(pollTranslation, 5000);
    });
    return button;
  }));
  if (!drafts.length) list.textContent = "Todavía no hay borradores.";
}

form.addEventListener("input", (event) => {
  if (event.target === articleBody) scheduleBodyPreview();
  if (event.target.closest("#english-result")) {
    workflowState.textContent = "Corrección en inglés sin guardar.";
    generateAudio.disabled = true;
    openPreview.disabled = true;
    prepareRelease.disabled = true;
    audioResult.hidden = true;
    return;
  }
  saveState.textContent = "Cambios sin guardar";
  generateEnglish.disabled = true;
  generateAudio.disabled = true;
  prepareRelease.disabled = true;
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
    await refreshList();
  } catch (error) {
    saveState.textContent = "No guardado";
    showError(error.message);
  }
});

async function pollTranslation() {
  if (!current) return null;
  try {
    const { translation } = await request(`/api/drafts/${current.articleId}/translation`);
    workflowState.textContent = translation.status === "queued" ? "Traducción en cola…" : translation.status === "running" ? "Generando inglés…" : translation.status === "completed" ? "Inglés listo · preparando audios automáticamente…" : "La traducción se detuvo.";
    if (translation.status === "completed") {
      clearInterval(translationTimer);
      translationTimer = null;
      document.querySelector("#english-title").value = translation.result.title;
      document.querySelector("#english-description").value = translation.result.description;
      document.querySelector("#english-body").value = translation.result.body;
      englishResult.hidden = false;
      generateEnglish.disabled = false;
      await refreshNotifications();
      generateAudio.disabled = translation.workflow === "preview";
      const audioStatus = await pollAudio();
      if (["queued", "running"].includes(audioStatus) && !audioTimer) audioTimer = setInterval(pollAudio, 5000);
    } else if (translation.status === "failed") {
      clearInterval(translationTimer);
      translationTimer = null;
      generateEnglish.disabled = false;
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
      body: JSON.stringify({ expectedRevision: current.revision, workflow: "preview" }),
    });
    workflowState.textContent = "Preparación automática iniciada · no necesitas pulsar los pasos siguientes.";
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
  try {
    const { audio } = await request(`/api/drafts/${current.articleId}/audio`);
    if (audio.status === "completed") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      workflowState.textContent = "Audios en español e inglés listos.";
      const cacheRevision = encodeURIComponent(`${audio.updatedAt}-${audio.jobs.es.jobId}`);
      const spanishPlayer = document.querySelector("#audio-es");
      const englishPlayer = document.querySelector("#audio-en");
      spanishPlayer.src = `/api/drafts/${current.articleId}/audio/es?v=${cacheRevision}`;
      englishPlayer.src = `/api/drafts/${current.articleId}/audio/en?v=${encodeURIComponent(audio.jobs.en.jobId)}`;
      spanishPlayer.load();
      englishPlayer.load();
      audioResult.hidden = false;
      regenerateSpanishAudio.disabled = false;
      regenerateEnglishAudio.disabled = false;
      generateAudio.disabled = false;
      openPreview.disabled = false;
      prepareRelease.disabled = false;
      await refreshNotifications();
      const releaseStatus = await pollRelease();
      if (["queued", "running"].includes(releaseStatus) && !releaseTimer) releaseTimer = setInterval(pollRelease, 5000);
    } else if (audio.status === "failed") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      generateAudio.disabled = false;
      showError(audio.error || "La generación de audio no pasó la validación.");
      await refreshNotifications();
    } else {
      workflowState.textContent = audio.status === "queued" ? "Audios en cola…" : "Generando audios…";
      regenerateSpanishAudio.disabled = true;
      regenerateEnglishAudio.disabled = true;
    }
    return audio.status;
  } catch (error) {
    if (!/not found/i.test(error.message)) showError(error.message);
    return null;
  }
}

generateAudio.addEventListener("click", async () => {
  if (!current) return;
  generateAudio.disabled = true;
  workflowState.textContent = "Enviando audios…";
  try {
    await request(`/api/drafts/${current.articleId}/audio`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: current.revision }),
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
  const button = locale === "en" ? regenerateEnglishAudio : regenerateSpanishAudio;
  const language = locale === "en" ? "inglés" : "español";
  button.disabled = true;
  message.hidden = true;
  workflowState.textContent = `Regenerando únicamente el audio en ${language}…`;
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

regenerateSpanishAudio.addEventListener("click", () => regenerateLocaleAudio("es"));
regenerateEnglishAudio.addEventListener("click", () => regenerateLocaleAudio("en"));

openPreview.addEventListener("click", () => {
  if (current) window.open(`/preview/${current.articleId}/es`, "_blank", "noopener,noreferrer");
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
      } }),
    });
    workflowState.textContent = "Corrección en inglés guardada · regenera los audios.";
    generateAudio.disabled = false;
    openPreview.disabled = true;
    prepareRelease.disabled = true;
    audioResult.hidden = true;
    await refreshNotifications();
  } catch (error) {
    showError(error.message);
  } finally {
    saveEnglish.disabled = false;
  }
});

async function pollRelease() {
  if (!current) return null;
  try {
    const { release } = await request(`/api/drafts/${current.articleId}/release`);
    if (release.status === "completed") {
      if (releaseTimer) clearInterval(releaseTimer);
      releaseTimer = null;
      workflowState.textContent = "Compilación privada validada · lista para publicar.";
      prepareRelease.disabled = false;
      publishRelease.disabled = false;
      generateEnglish.disabled = true;
      await refreshNotifications();
    } else if (release.status === "failed") {
      if (releaseTimer) clearInterval(releaseTimer);
      releaseTimer = null;
      prepareRelease.disabled = false;
      showError(release.error || "La compilación privada no pasó la validación.");
      await refreshNotifications();
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

publishRelease.addEventListener("click", async () => {
  if (!current || !window.confirm("¿Publicar ahora las versiones en español e inglés en fanaticosos.com?")) return;
  publishRelease.disabled = true;
  try {
    await request(`/api/drafts/${current.articleId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: current.revision }) });
    workflowState.textContent = "Publicación iniciada… el sitio actual permanece activo durante la validación.";
    const timer = setInterval(async () => { const { deployment } = await request(`/api/drafts/${current.articleId}/publish`); if (deployment.status === "completed") { clearInterval(timer); workflowState.textContent = "Publicado y verificado en fanaticosos.com."; } if (deployment.status === "failed") { clearInterval(timer); publishRelease.disabled = false; showError(deployment.error); } }, 4000);
  } catch (error) { publishRelease.disabled = false; showError(error.message); }
});

document.querySelector("#new-draft").addEventListener("click", () => {
  current = null;
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
  const [publisherResponse, musicResponse] = await Promise.all([request("/api/settings"), request("/api/music")]);
  publisherSettings = publisherResponse.settings;
  applySettings(publisherSettings);
  renderMusic(musicResponse.settings);
  setFields(null);
  await Promise.all([refreshList(), refreshNotifications()]);
}

initialize().catch((error) => showError(error.message));
