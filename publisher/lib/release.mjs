import { extname } from "node:path";
import yaml from "js-yaml";

export function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function frontmatter(data) {
  return `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd()}\n---\n`;
}

export function serializeArticlePair({ draft, translation, audio, settings, publishedAt }) {
  if (translation.status !== "completed" || audio.status !== "completed") throw new Error("release requires accepted translation and audio");
  if (translation.draftRevision !== draft.revision || audio.draftRevision !== draft.revision) throw new Error("release outputs are stale");
  if (!translation.provenance || !translation.sourceRevision) throw new Error("translation provenance is incomplete");
  const categoryId = slugify(draft.category);
  const imageExtension = draft.featuredImage.path ? extname(draft.featuredImage.path).toLowerCase() : "";
  const imagePath = draft.featuredImage.path ? `/images/articles/${draft.articleId}${imageExtension}` : null;
  const shared = {
    articleId: draft.articleId,
    author: settings.author.name,
    publishedAt,
    status: "published",
    categoryId,
    tags: draft.tags,
    sourceRevision: translation.sourceRevision,
    ...(imagePath ? { featuredImage: {
      src: imagePath, alt: draft.featuredImage.alt || draft.title,
      ...((draft.featuredImage.caption || draft.featuredImage.credit) ? { credit: draft.featuredImage.caption || draft.featuredImage.credit } : {}),
    } } : {}),
  };
  const enAudio = audio.jobs.en.result;
  const versionedAudioPath = (result) => {
    if (!/^[0-9a-f]{64}$/.test(result.sha256 ?? "")) throw new Error("release audio checksum is invalid");
    return `/audio/${result.file}?v=${result.sha256.slice(0, 16)}`;
  };
  const es = {
    ...shared, locale: "es", slug: slugify(draft.title), title: draft.title,
    description: draft.description, category: draft.category,
  };
  const en = {
    ...shared, locale: "en", slug: slugify(translation.result.title), title: translation.result.title,
    description: translation.result.description, category: draft.category,
    translation: {
      sourceRevision: translation.sourceRevision,
      engine: translation.provenance.engine,
      model: translation.provenance.model,
      configurationVersion: String(translation.provenance.configurationVersion),
      glossaryVersion: String(translation.provenance.glossaryVersion),
      generatedAt: translation.provenance.generatedAt,
    },
    audio: { path: versionedAudioPath(enAudio), durationSeconds: enAudio.durationSeconds, voice: enAudio.voice, engine: enAudio.engine, textHash: enAudio.textHash, generatedAt: enAudio.generatedAt },
  };
  return {
    files: {
      [`src/content/articles/es/${draft.articleId}.md`]: `${frontmatter(es)}\n${draft.body.trim()}\n`,
      [`src/content/articles/en/${draft.articleId}.md`]: `${frontmatter(en)}\n${translation.result.body.trim()}\n`,
    },
    assets: {
      enAudio: { sourceJobId: audio.jobs.en.jobId, file: enAudio.file, publicPath: `public/audio/${enAudio.file}` },
      ...(imagePath ? { image: { sourcePath: draft.featuredImage.path, publicPath: `public${imagePath}` } } : {}),
    },
  };
}
