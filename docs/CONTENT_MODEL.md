# Fanaticosos Blog Content Model

Status: Proposed for owner approval
Phase: 2 — Content foundation
Scope: Article files, bilingual relationships, URLs, validation, and publishing ergonomics

## Owner-approved requirements

- Spanish is the authoritative source language. The owner writes each article once in Spanish.
- English translation is generated automatically.
- The language control switches the complete article: visible text, metadata, URL, and audio.
- Translation and pronunciation handling must preserve NFL/American-football terminology, Chicago Bears context, and proper names without adding routine publishing work for the owner.
- Publishing must remain easy and suitable for a hobby project with a zero-recurring-cost target.
- Search-engine metadata is important, but it must not make publishing or reading difficult.
- Generated audio, temporary files, downloaded models, and secrets must not be committed to Git.
- A failed translation, audio generation, build, or validation must not replace the last healthy published site.
- Existing Substack content is not being migrated.

## Recommended source layout

Each article has one stable `articleId`. Spanish and English files use the same ID so they remain paired even when their titles or URLs differ.

```text
src/content/articles/
├── es/
│   └── <article-id>.md
└── en/
    └── <article-id>.md
```

The owner-facing editor should create and maintain these files. The intended routine authoring fields are only:

- title
- article body
- category
- tags
- optional featured image and its description/credit

IDs, timestamps, translation metadata, hashes, audio metadata, and file placement should be generated automatically.

## Recommended URL contract

Spanish remains the default language and does not receive a language prefix:

```text
/blog/
/blog/<spanish-slug>/
```

English receives an explicit prefix:

```text
/en/blog/
/en/blog/<english-slug>/
```

This preserves concise Spanish-first URLs while making the English version unambiguous. A title edit does not change an existing slug unless the owner deliberately changes it.

The language switch resolves the corresponding page by `articleId`, never by guessing or translating the current slug.

## Recommended article fields

The content collection schema should validate the following fields at build time.

| Field | Purpose | Managed by |
|---|---|---|
| `articleId` | Immutable identifier shared by the language pair | System |
| `locale` | `es` or `en` | System |
| `slug` | Locale-specific URL segment | Initially generated; owner may edit |
| `title` | Article headline | Owner in Spanish; translation system in English |
| `description` | Search and social summary | Owner/editor or generated draft |
| `author` | Published byline | Editor default, owner-editable |
| `publishedAt` | Original publication time | System/editor |
| `updatedAt` | Optional material-update time | System |
| `status` | `draft`, `review`, `ready`, `published`, or `archived` | Workflow |
| `categoryId` | Stable category identifier shared by the language pair | System |
| `category` | Primary sports category | Owner |
| `tags` | Optional discovery terms | Owner |
| `featuredImage` | Optional image path | Owner/editor |
| `featuredImageAlt` | Accessible image description | Owner/editor |
| `featuredImageCaption` | Optional displayed caption | Owner/editor |
| `featuredImageCredit` | Optional attribution | Owner/editor |
| `sourceRevision` | Hash or revision linking English to its Spanish source | System |
| `translation` | Provenance, model/config version, glossary version, and generation time | System |
| `audio` | Path, duration, voice, engine, text hash, and generation time | System |

Translation and audio metadata are operational records, not owner authoring tasks. No credentials or private configuration belong in article files.

## Publishing and validation rules

1. Spanish content is the authoritative source.
2. Every article file must pass its schema before it can be built.
3. `articleId`, locale, and slug combinations must be unique.
4. A bilingual publication requires a valid Spanish file and its valid English pair.
5. Paired articles must agree on factual shared metadata such as author, publication date, category, and featured-image source.
6. Draft and review content is excluded from the public production build.
7. Each published page has its own canonical URL and `hreflang` links for `es`, `en`, and `x-default`.
8. The language control links directly to the paired article using `articleId`.
9. Translation provenance must show whether English is current with the latest Spanish source revision.
10. Audio provenance must show whether the MP3 is current with the rendered article text.
11. During the initial content-foundation work, audio may be absent. It becomes a publication requirement only after the TTS phase is implemented and approved.
12. If generation or validation fails, the publishing workflow stops before deployment and preserves the last healthy site.

## Glossary and pronunciation behavior

The NFL and Chicago Bears glossary and pronunciation overrides should live in centrally managed configuration, not require additions to every article. The processing pipeline applies them automatically.

The editor may later expose an optional correction control for exceptional cases, but normal publishing must not require glossary or pronunciation work.

## Recommended first fixture

Phase 2 should use one clearly marked, unpublished sample article pair to prove:

- collection validation
- Spanish and English static routes
- language-pair resolution by `articleId`
- canonical and `hreflang` metadata
- exclusion of drafts from a production build

It should not contain or imply migrated Substack content, and it must not be deployed without owner authorization.

## Unknown information requiring an owner decision later

- Final category taxonomy.
- Default public byline and whether multiple authors are needed.
- Publication timezone. `America/Chicago` is a reasonable candidate but is not approved here.
- Whether the owner wants to edit generated English headlines and slugs before publication.
- Featured-image sourcing, licensing, storage, and attribution policy.
- Whether incomplete English or audio should ever be allowed for an urgent Spanish-only publication. The current recommendation is no for the final bilingual workflow.

These unknowns do not block a local, unpublished Phase 2 fixture if temporary test-only values are clearly identified.

## Acceptance criteria for this design

- The owner can author the substance of an article once in Spanish without maintaining technical metadata.
- Spanish and English pages may have natural, different slugs while remaining reliably paired.
- Switching language navigates to the complete corresponding article.
- Schema validation catches incomplete or stale generated content before deployment.
- The model supports SEO metadata and accessibility without exposing extra routine work in the publishing interface.
- No generated audio, models, temporary artifacts, or secrets are placed in Git.
- No part of this design requires a paid service or enables billing.
