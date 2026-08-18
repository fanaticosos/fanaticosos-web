import assert from "node:assert/strict";

import { validateGeneratedMedia } from "./build-media-policy.mjs";

const articleId = "11d4e275-93be-48e1-920a-5e6884672c52";
const expectedAudio = [`audio/es-${articleId}.mp3`, `audio/en-${articleId}.mp3`];
const releaseEnvironment = {
  FANATICOSOS_PRIVATE_RELEASE_BUILD: "1",
  FANATICOSOS_RELEASE_ARTICLE_ID: articleId,
};

assert.deepEqual(validateGeneratedMedia(["index.html"]), []);
assert.deepEqual(validateGeneratedMedia(["index.html", ...expectedAudio]), [
  `Phase 1 dist unexpectedly contains generated audio: audio/en-${articleId}.mp3`,
  `Phase 1 dist unexpectedly contains generated audio: audio/es-${articleId}.mp3`,
]);
assert.deepEqual(validateGeneratedMedia(["index.html", ...expectedAudio], releaseEnvironment), []);
assert.deepEqual(
  validateGeneratedMedia(["index.html", ...expectedAudio, "audio/unrelated.mp3"], releaseEnvironment),
  [
    "private release dist contains unexpected generated audio: audio/unrelated.mp3",
  ],
);
assert.deepEqual(
  validateGeneratedMedia(["index.html", expectedAudio[0]], releaseEnvironment),
  [
    `private release dist is missing required generated audio: audio/en-${articleId}.mp3`,
  ],
);
assert.deepEqual(
  validateGeneratedMedia(["index.html", ...expectedAudio], { FANATICOSOS_PRIVATE_RELEASE_BUILD: "1" }),
  ["private release build is missing a valid FANATICOSOS_RELEASE_ARTICLE_ID"],
);

console.log("Validated normal and private-release generated-media policies.");
