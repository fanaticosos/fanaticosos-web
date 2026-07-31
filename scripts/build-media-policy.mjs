const generatedMediaPattern = /\.(?:mp3|wav|flac)$/i;
const articleIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateGeneratedMedia(outputFiles, environment = process.env) {
  const generatedMedia = outputFiles.filter((file) => generatedMediaPattern.test(file)).sort();
  const privateReleaseBuild = environment.FANATICOSOS_PRIVATE_RELEASE_BUILD === "1";

  if (!privateReleaseBuild) {
    return generatedMedia.map((file) => `Phase 1 dist unexpectedly contains generated audio: ${file}`);
  }

  const articleId = environment.FANATICOSOS_RELEASE_ARTICLE_ID;
  if (!articleIdPattern.test(articleId ?? "")) {
    return ["private release build is missing a valid FANATICOSOS_RELEASE_ARTICLE_ID"];
  }

  const expected = [`audio/en-${articleId}.mp3`, `audio/es-${articleId}.mp3`].sort();
  const failures = [];
  for (const file of generatedMedia) {
    if (!expected.includes(file)) failures.push(`private release dist contains unexpected generated audio: ${file}`);
  }
  for (const file of expected) {
    if (!generatedMedia.includes(file)) failures.push(`private release dist is missing required generated audio: ${file}`);
  }
  return failures;
}
