const form = document.querySelector("#article-form");
const list = document.querySelector("#draft-list");
const message = document.querySelector("#message");
const saveState = document.querySelector("#save-state");
const pageTitle = document.querySelector("#page-title");
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
const openPreview = document.querySelector("#open-preview");
let translationTimer = null;
let audioTimer = null;

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
      caption: data.get("imageCaption"),
      credit: data.get("imageCredit"),
    },
  };
}

function setFields(draft) {
  if (translationTimer) clearInterval(translationTimer);
  translationTimer = null;
  if (audioTimer) clearInterval(audioTimer);
  audioTimer = null;
  form.elements.title.value = draft?.title ?? "";
  form.elements.description.value = draft?.description ?? "";
  form.elements.body.value = draft?.body ?? "";
  form.elements.category.value = draft?.category ?? publisherSettings?.defaultCategory ?? "";
  form.elements.season.value = draft?.season ?? publisherSettings?.defaultSeason ?? "";
  form.elements.tags.value = draft?.tags?.join(", ") ?? publisherSettings?.defaultTags?.join(", ") ?? "";
  form.elements.imagePath.value = draft?.featuredImage?.path ?? "";
  form.elements.imageAlt.value = draft?.featuredImage?.alt ?? "";
  form.elements.imageCaption.value = draft?.featuredImage?.caption ?? "";
  form.elements.imageCredit.value = draft?.featuredImage?.credit ?? "";
  imagePreview.src = draft?.featuredImage?.path ?? "";
  imagePreview.hidden = !draft?.featuredImage?.path;
  pageTitle.textContent = draft?.title || "Nuevo artículo";
  saveState.textContent = draft ? `Guardado · revisión ${draft.revision}` : "Sin guardar";
  generateEnglish.disabled = !draft;
  workflowState.textContent = draft ? "Listo para generar la versión en inglés." : "Guarda un borrador válido para comenzar.";
  englishResult.hidden = true;
  audioResult.hidden = true;
  generateAudio.disabled = true;
  openPreview.disabled = true;
}

function applySettings(settings) {
  document.querySelector("#owner-name").textContent = settings.author.name;
  document.querySelector("#owner-social").textContent = settings.author.socialHandle;
  document.querySelector("#owner-timezone").textContent = settings.timezone;
  document.querySelector("#promotion-heading").textContent = settings.promotion.heading;
  document.querySelector("#promotion-label").textContent = settings.promotion.label;
  const links = settings.promotion.platforms.map((platform) => {
    const anchor = document.createElement("a");
    anchor.href = platform.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = platform.name;
    return anchor;
  });
  document.querySelector("#promotion-links").replaceChildren(...links);
}

async function refreshNotifications() {
  const { notifications } = await request("/api/notifications");
  const pending = notifications.filter((item) => !item.acknowledgedAt);
  const container = document.querySelector("#notification-list");
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

form.addEventListener("input", () => {
  saveState.textContent = "Cambios sin guardar";
  generateEnglish.disabled = true;
  generateAudio.disabled = true;
  message.hidden = true;
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
    workflowState.textContent = translation.status === "queued" ? "Traducción en cola…" : translation.status === "running" ? "Generando inglés…" : translation.status === "completed" ? "Versión en inglés lista." : "La traducción se detuvo.";
    if (translation.status === "completed") {
      clearInterval(translationTimer);
      translationTimer = null;
      document.querySelector("#english-title").value = translation.result.title;
      document.querySelector("#english-description").value = translation.result.description;
      document.querySelector("#english-body").value = translation.result.body;
      englishResult.hidden = false;
      generateEnglish.disabled = false;
      await refreshNotifications();
      generateAudio.disabled = false;
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
      body: JSON.stringify({ expectedRevision: current.revision }),
    });
    workflowState.textContent = "Traducción en cola…";
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
      document.querySelector("#audio-es").src = `/api/drafts/${current.articleId}/audio/es`;
      document.querySelector("#audio-en").src = `/api/drafts/${current.articleId}/audio/en`;
      audioResult.hidden = false;
      generateAudio.disabled = false;
      openPreview.disabled = false;
      await refreshNotifications();
    } else if (audio.status === "failed") {
      if (audioTimer) clearInterval(audioTimer);
      audioTimer = null;
      generateAudio.disabled = false;
      showError(audio.error || "La generación de audio no pasó la validación.");
      await refreshNotifications();
    } else {
      workflowState.textContent = audio.status === "queued" ? "Audios en cola…" : "Generando audios…";
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

openPreview.addEventListener("click", () => {
  if (current) window.open(`/preview/${current.articleId}/es`, "_blank", "noopener,noreferrer");
});

document.querySelector("#new-draft").addEventListener("click", () => {
  current = null;
  form.reset();
  setFields(null);
  message.hidden = true;
  refreshList().catch((error) => showError(error.message));
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
  publisherSettings = (await request("/api/settings")).settings;
  applySettings(publisherSettings);
  setFields(null);
  await Promise.all([refreshList(), refreshNotifications()]);
}

initialize().catch((error) => showError(error.message));
