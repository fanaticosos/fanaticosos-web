import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("reviewed translation starts one automatic preparation workflow", () => {
  assert.match(html, /Generar audios y preparar publicación/);
  assert.match(app, /previewRequestedArticleId = current\.articleId;/);
  assert.match(
    app,
    /confirmReviewed: true, workflow: "preview"/,
  );
  assert.match(
    app,
    /después se crearán el video y la vista previa automáticamente/,
  );
});
