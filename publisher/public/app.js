const form = document.querySelector("#article-form");
const list = document.querySelector("#draft-list");
const message = document.querySelector("#message");
const saveState = document.querySelector("#save-state");
const pageTitle = document.querySelector("#page-title");
let current = null;

function fields() {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    description: data.get("description"),
    body: data.get("body"),
    category: data.get("category"),
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
  form.elements.title.value = draft?.title ?? "";
  form.elements.description.value = draft?.description ?? "";
  form.elements.body.value = draft?.body ?? "";
  form.elements.category.value = draft?.category ?? "Chicago Bears";
  form.elements.tags.value = draft?.tags?.join(", ") ?? "NFL, Chicago Bears";
  form.elements.imagePath.value = draft?.featuredImage?.path ?? "";
  form.elements.imageAlt.value = draft?.featuredImage?.alt ?? "";
  form.elements.imageCaption.value = draft?.featuredImage?.caption ?? "";
  form.elements.imageCredit.value = draft?.featuredImage?.credit ?? "";
  pageTitle.textContent = draft?.title || "Nuevo artículo";
  saveState.textContent = draft ? `Guardado · revisión ${draft.revision}` : "Sin guardar";
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
    });
    return button;
  }));
  if (!drafts.length) list.textContent = "Todavía no hay borradores.";
}

form.addEventListener("input", () => {
  saveState.textContent = "Cambios sin guardar";
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

document.querySelector("#new-draft").addEventListener("click", () => {
  current = null;
  form.reset();
  setFields(null);
  message.hidden = true;
  refreshList().catch((error) => showError(error.message));
});

setFields(null);
refreshList().catch((error) => showError(error.message));
