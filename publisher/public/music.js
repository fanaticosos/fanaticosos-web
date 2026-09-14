const form = document.querySelector("#music-form");
const button = document.querySelector("#save-music");
const state = document.querySelector("#music-state");
const errorBox = document.querySelector("#music-error");
const input = document.querySelector("#weekly-song-url");
let activeJobId = null;
let polling = false;

async function request(url, options) {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "La operación no pudo completarse.");
  return value;
}

function renderSong(settings) {
  const song = settings.music.weeklySong;
  input.value = settings.music.weeklySongUrl;
  document.querySelector("#music-cover").src = song.coverUrl;
  document.querySelector("#music-cover").alt = `Portada de ${song.album || song.title}`;
  document.querySelector("#music-title").textContent = song.title;
  document.querySelector("#music-artist").textContent = `${song.artist}${song.album ? ` · ${song.album}` : ""}`;
  document.querySelector("#music-audio").src = song.streamUrl;
  document.querySelector("#music-preview").hidden = false;
}

function renderPublication(publication) {
  if (!publication) { state.textContent = "Lista para cambiar"; return false; }
  if (publication.status === "completed") {
    state.textContent = "✓ Publicada en la página principal";
    button.disabled = false;
    return true;
  }
  if (publication.status === "failed") {
    state.textContent = "No se pudo publicar";
    errorBox.textContent = publication.error || "La publicación falló. Puedes intentarlo otra vez.";
    errorBox.hidden = false;
    button.disabled = false;
    return true;
  }
  activeJobId = publication.jobId;
  state.textContent = "Publicando… puedes salir de esta pantalla";
  button.disabled = true;
  return false;
}

async function pollPublication() {
  if (polling) return;
  polling = true;
  try {
    while (activeJobId) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const { settings, publication } = await request("/api/music");
      renderSong(settings);
      if (publication?.jobId !== activeJobId || renderPublication(publication)) activeJobId = null;
    }
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.disabled = false;
  } finally { polling = false; }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  state.textContent = "Verificando canción…";
  errorBox.hidden = true;
  try {
    const { settings, publication } = await request("/api/music", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeklySongUrl: input.value.trim() }),
    });
    renderSong(settings);
    activeJobId = publication.jobId;
    renderPublication(publication);
    pollPublication();
  } catch (error) {
    state.textContent = "No se cambió la canción";
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.disabled = false;
  }
});

request("/api/music").then(({ settings, publication }) => {
  renderSong(settings);
  if (!renderPublication(publication)) pollPublication();
}).catch((error) => {
  errorBox.textContent = error.message;
  errorBox.hidden = false;
});
