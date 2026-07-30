import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const imageMetadata = z.object({
  src: z.string().startsWith("/"),
  alt: z.string().min(1),
  caption: z.string().min(1).optional(),
  credit: z.string().min(1).optional(),
});

const translationMetadata = z.object({
  sourceRevision: z.string().min(1),
  engine: z.string().min(1),
  model: z.string().min(1),
  configurationVersion: z.string().min(1),
  glossaryVersion: z.string().min(1),
  generatedAt: z.coerce.date(),
});

const audioMetadata = z.object({
  path: z.string().startsWith("/").endsWith(".mp3"),
  durationSeconds: z.number().positive(),
  voice: z.string().min(1),
  engine: z.string().min(1),
  textHash: z.string().min(1),
  generatedAt: z.coerce.date(),
});

const articles = defineCollection({
  loader: glob({ base: "./src/content/articles", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    articleId: z.uuid(),
    locale: z.enum(["es", "en"]),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    author: z.string().min(1),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    status: z.enum(["draft", "review", "ready", "published", "archived"]),
    category: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    featuredImage: imageMetadata.optional(),
    sourceRevision: z.string().min(1),
    translation: translationMetadata.optional(),
    audio: audioMetadata.optional(),
    fixture: z.boolean().default(false),
  }),
});

export const collections = { articles };
