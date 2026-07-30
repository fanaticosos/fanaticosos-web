# Fanaticosos Blog — Implementation and Deployment Plan

Status: Draft for owner review
Plan date: 2026-07-29
Repository: `fanaticosos/fanaticosos-web`
Working branch: `feature/multilingual-audio-blog`
Baseline: `docs/PHASE_0_DISCOVERY.md`

## 1. Goal

Extend the existing Fanaticosos website with an original sports-journalism blog that:

- preserves the current brand, layout, logo, and animation;
- lets the owner write each article once in Spanish;
- creates a complete English article automatically;
- creates Spanish and English audio automatically;
- publishes distinct Spanish and English pages with appropriate SEO;
- is simple for the owner to publish and simple for readers to use;
- targets zero recurring cost;
- keeps generated audio, models, temporary data, and secrets out of Git;
- cannot replace a healthy production deployment when processing fails.

## 2. Authority and release rules

### Owner authority

- The owner approves product decisions and production releases.
- No billing, production deployment, domain change, Git push, or pull request occurs without owner authorization.
- Any later decision to automate production deployment must be explicit and documented.

### Working rules

- Work remains on `feature/multilingual-audio-blog` until the owner approves integration.
- Each phase has an observable acceptance gate.
- A failed gate stops progression; it does not trigger an improvised production change.
- Generated assets are reproducible and are not committed to Git.
- Secrets are stored only in restricted local or service configuration.
- Documentation records the verified final path, not abandoned experiments.

## 3. Target architecture

### GitHub

GitHub stores and versions:

- Astro application code;
- Spanish source articles;
- generated English article text after editorial acceptance;
- glossary and translation rules;
- article metadata and media attribution;
- tests, validation rules, and deployment manifests;
- rebuilding and recovery documentation.

GitHub does not store:

- generated MP3 files;
- downloaded translation or TTS models;
- caches and temporary processing files;
- access tokens or private keys.

### papabear

The private `papabear` server:

- hosts the owner-only publishing interface over NetBird;
- validates Spanish article input;
- generates English translations;
- generates Spanish and English speech;
- processes images and audio;
- builds the complete static Astro site;
- runs pre-deployment validation;
- retains the last known-good build and processing logs;
- uploads an approved complete build to Cloudflare Pages.

No public inbound service is required for the initial automation. Administrative and editor access remain private through NetBird.

### Cloudflare Pages

Cloudflare Pages:

- serves the completed static website and audio globally;
- continues serving the last successful deployment when processing fails;
- provides preview deployments during the website migration;
- becomes the recipient of complete `dist/` uploads after the publishing pipeline is proven.

R2 is deferred. It will be considered only if measured Pages limitations, bandwidth, storage, or cost justify the additional service.

## 4. Content contract

### Spanish source article

Each source article will contain validated metadata, including:

- stable article identifier;
- Spanish title and summary;
- publication status and date;
- author;
- category and tags;
- canonical Spanish slug;
- featured image, alternative text, caption, and credit;
- optional manual pronunciation or translation overrides.

The body is stored as Markdown. The private visual editor hides Markdown syntax during normal use.

### Generated English article

The English version will contain:

- a stable link to the same article identifier;
- translated title, summary, body, and SEO metadata;
- a distinct English slug;
- the same factual publication date, author, images, and attribution;
- a record of the translation engine and source revision used.

### Language relationship

- Spanish and English pages have distinct crawlable URLs.
- The page-level language control navigates to the paired article.
- Each page declares its language, canonical URL, and reciprocal `hreflang` links.
- Navigation, labels, metadata, structured data, and audio change with the selected language.
- Missing or invalid translation prevents the new revision from publishing; it does not remove the current article.

## 5. Phased delivery

## Phase 1 — Astro foundation and visual parity

### Objective

Convert the current static site into a maintainable Astro static site without intentionally changing its public appearance or behavior.

### Work

- Record reference screenshots at agreed desktop and mobile sizes.
- Initialize Astro using static output.
- Reproduce the existing home, contact, and terms pages.
- Preserve the current logo file, glow/floating effect, colors, typography, links, responsive behavior, RedCircle embed, and Substack link.
- Add reusable layout, header, footer, metadata, and navigation components.
- Add formatting, build, internal-link, and HTML checks.
- Configure Cloudflare branch preview build settings only when required and only after owner authorization for that configuration change.

### Acceptance gate

- Local build completes without errors.
- Existing URLs render successfully.
- Desktop and mobile visual comparisons show no unapproved material differences.
- Current links and embeds work.
- A Cloudflare preview, if authorized, is reviewed by the owner.
- Production remains at the current known-good commit.

### Rollback

Discard or revise the feature-branch migration. Production remains unchanged.

## Phase 2 — Bilingual content and SEO

### Objective

Add the article model and complete Spanish/English reading experience before introducing automated translation.

### Work

- Define and validate article front matter.
- Add Spanish and English article collections linked by stable article ID.
- Add localized listing, article, category, and feed pages.
- Implement the whole-page language switch.
- Add canonical URLs, `hreflang`, Open Graph metadata, structured article data, sitemap entries, and language-specific RSS/Atom feeds.
- Add accessible article layout and audio-player placeholder.
- Create one manually prepared bilingual fixture article for functional testing.

### Acceptance gate

- Both language URLs build and link to each other.
- Page chrome and metadata switch completely.
- The sitemap and feeds contain the correct localized URLs.
- Structured data and page-language attributes validate.
- Keyboard and mobile navigation work.
- No translation or TTS service is required to build the fixture.

### Rollback

Remove bilingual feature changes from the working branch. Production remains unchanged.

## Phase 3 — papabear processing baseline

### Objective

Prepare the private processing host reproducibly without exposing a public service.

### Work

- Document and install only approved system dependencies.
- Install an LTS Node.js release, FFmpeg/ffprobe, isolated Python tooling, and required build packages.
- Create a dedicated least-privilege service account and application directories.
- Define separate source, model, cache, generated-audio, build, release, log, and backup locations.
- Set restrictive permissions.
- Add disk, memory, process, and log-retention safeguards.
- Clone the business repository with a dedicated read-oriented deploy credential initially.
- Create systemd units only after commands work interactively and predictably.
- Keep UFW unchanged until the separate NetBird-aware firewall design is approved.

### Acceptance gate

- Rebuilding dependencies from documentation succeeds.
- The Astro project builds on `papabear`.
- FFmpeg and ffprobe pass an audio round-trip check.
- The service account cannot read unrelated credentials or administer the host.
- Required outbound sources remain reachable.
- NetBird and SSH access remain healthy.

### Rollback

Stop and disable new project services and remove only the dedicated project runtime after confirming its exact ownership. Existing SSH and NetBird configuration remain intact.

## Phase 4 — Translation benchmark and integration

### Objective

Select a local translation engine using measured Spanish sports-journalism quality, resource use, and processing time.

### Work

- Create an owner-approved benchmark set containing NFL headlines, game recaps, analysis, quotations, Chicago Bears and NFC North names, statistics, idioms, and American-football terminology.
- Define the glossary and protected-name rules.
- Test a small number of viable open-source models on `papabear`.
- Record model license, download size, RAM use, processing time, and observed quality.
- Present blind or side-by-side samples to the owner.
- Integrate only the selected model.
- Store translation provenance and regenerate only when the Spanish source or translation configuration changes.
- Provide a preview and correction step before publication.

### Acceptance gate

- The owner accepts the selected model and test translations.
- Player, team, league, stadium, score, quotation, statistic, and NFL terminology survive validation.
- Translation fits available CPU, RAM, storage, and acceptable wait time.
- A failed translation leaves the prior generated English revision intact.

### Rollback

Keep the manually prepared bilingual fixture and remove the unaccepted engine integration. No production dependency exists yet.

## Phase 5 — TTS benchmark and integration

### Objective

Select acceptable Spanish and English voices and create reproducible, web-ready article audio.

### Work

- Test Kokoro first as a candidate, then test alternatives only if quality or compatibility is insufficient.
- Use representative Spanish and English journalism samples.
- Evaluate pronunciation, names, numbers, scores, abbreviations, pacing, and long-form listening comfort.
- Record model license, voice license, model size, RAM use, render speed, and owner quality rating.
- Add pronunciation overrides without requiring routine per-article work.
- Normalize and encode audio with an agreed format, bitrate, loudness target, and metadata.
- Generate deterministic audio paths and manifests.
- Regenerate only when relevant text, voice, pronunciation, or encoding settings change.

### Acceptance gate

- The owner approves at least one Spanish and one English voice.
- A full representative article renders successfully on `papabear`.
- Audio duration, file integrity, loudness, metadata, and page association validate automatically.
- Long text does not truncate or omit sections.
- A failed TTS job preserves the prior valid audio and production release.

### Rollback

Remove the unaccepted voice/model integration and retain text-only bilingual pages on the working branch.

## Phase 6 — Private publishing interface

### Objective

Let the owner create, preview, correct, and publish an article from a private browser page without terminal commands.

### Work

- Provide an editor reachable only over NetBird.
- Support Spanish title, summary, body, category, tags, featured image, captions, credits, and publication scheduling/status.
- Provide drag-and-drop image upload and safe filenames.
- Validate required fields and show actionable errors.
- Show Spanish page preview, generated English preview, and both audio previews.
- Allow translation and pronunciation corrections without altering the Spanish source unnecessarily.
- Provide explicit Save Draft, Regenerate, Preview, and Publish actions.
- Provide simple homepage settings for the complete music-playlist URL and weekly-song URL.
- Serialize content to the repository's Markdown contract.
- Keep an auditable local job and publication history without storing secrets in articles.

### Acceptance gate

- The owner completes a test article without editing Markdown or using a terminal.
- Closing and reopening the editor does not lose a saved draft.
- Invalid metadata, missing image attribution, failed translation, or failed audio blocks publication with a clear explanation.
- The owner can preview both full language pages and audio before publication.
- Editor access is unavailable outside the authorized NetBird path.

### Rollback

Stop the private editor service. Source Markdown remains readable and editable with standard tools.

## Phase 7 — End-to-end release pipeline

### Objective

Build a complete, validated, recoverable release while production deployment remains owner-controlled.

### Work

- Assemble source validation, translation, TTS, image processing, Astro build, and release validation into one idempotent job.
- Use a staging directory and atomic release promotion.
- Generate a release manifest containing source revision, article revisions, model/config versions, audio checksums, build time, and validation results.
- Retain the last known-good local release.
- Add locking so two publications cannot overlap.
- Add timeouts, bounded retries, structured logs, and clear failure reporting.
- Test with simulated translation, TTS, build, and network failures.
- Keep Cloudflare deployment disabled in the test job until separately authorized.

### Acceptance gate

- Re-running an unchanged article does not unnecessarily regenerate translation or audio.
- Every simulated failure stops before deployment and preserves the prior release.
- The complete `dist/` contains all required localized pages, images, audio, feeds, sitemap, and metadata.
- A clean rebuild from documented source and cached/downloadable models produces a valid release.
- Disk and log retention remain within defined limits.

### Rollback

Select the retained last known-good release locally. No Cloudflare state changes during this phase.

## Phase 8 — Cloudflare deployment transition

### Objective

Transition the existing Pages project from automatic production builds to validated complete-build uploads without changing domains.

### Required owner authorization

This phase changes production behavior. Before proceeding, the owner must approve:

- disabling automatic production deployments;
- creating a restricted Cloudflare deployment token;
- storing that token on `papabear` with restrictive permissions;
- performing a preview upload;
- performing the first production upload.

### Work

- Record the current Cloudflare configuration and last known-good deployment.
- Confirm the rollback method before changing settings.
- Disable automatic production deployment while retaining the existing project and domains.
- Create a least-privilege token limited to the required account/project deployment action.
- Store the token outside Git under the dedicated service account.
- Upload the complete build to a non-production preview and validate it.
- With explicit authorization, upload the approved build to production.
- Verify custom domains, TLS, page routes, language pairs, images, audio, feeds, sitemap, caching, and error responses.

### Acceptance gate

- The approved release is served from all production domains.
- Spanish and English pages and audio load from an external client.
- Production corresponds to the recorded release manifest.
- Git pushes alone no longer bypass translation, audio, and release validation.
- The previous Cloudflare deployment remains available for rollback.

### Rollback

Use Cloudflare's retained deployment history to restore the previously verified deployment. Investigate before attempting another release.

## Phase 9 — Operations and recovery

### Objective

Make routine publishing and full recovery understandable and low-maintenance.

### Work

- Document normal draft, preview, correction, publish, and rollback procedures.
- Document repository, server, model, generated-audio, and Cloudflare recovery responsibilities.
- Back up source and configuration; treat reproducible caches separately from irreplaceable data.
- Add non-billing monitoring for failed jobs, disk pressure, stale releases, and site health where practical.
- Define model-update and dependency-update review procedures.
- Test restoration of one article and one complete release.
- Record measured Cloudflare Pages usage and revisit R2 only when evidence supports it.

### Acceptance gate

- The owner can publish a routine article from the private editor.
- A documented rollback can restore the prior site.
- A clean-server rebuild is possible from Git, documented configuration, credentials supplied out of band, and downloadable model artifacts.
- Alerts or status checks identify a failed job without affecting production.

## 6. Initial quality gates

Before any production release, the pipeline must verify at minimum:

- repository and content schema validity;
- unique article IDs and slugs;
- paired Spanish and English pages;
- canonical and reciprocal `hreflang` metadata;
- valid internal links, images, feeds, sitemap, and structured data;
- HTML language and accessibility basics;
- complete and decodable audio with nonzero duration;
- no secret, private key, model, cache, temporary directory, or generated MP3 staged for Git;
- build output contains no private editor or administrative endpoint;
- release manifest matches the build being uploaded.

## 7. Cost controls

### Approved principle

Recurring cost is a release criterion, not an afterthought.

### Controls

- Prefer local CPU processing on existing `papabear` capacity.
- Use open-source models only after license review.
- Do not enable paid APIs, Cloudflare billing, R2, or another hosted service without owner authorization.
- Cache translation and audio by source/configuration hash to avoid repeated processing.
- Compress images and audio to measured quality targets.
- Establish local retention limits before enabling routine generation.
- Review actual Pages usage before changing storage architecture.

## 8. Security controls

- Keep authoring and administration private over NetBird.
- Do not expose SSH or the publishing editor publicly.
- Use dedicated service identities with the minimum required access.
- Separate GitHub source access from Cloudflare deployment access.
- Use encrypted or permission-restricted credential storage; never Git.
- Preserve Hyper-V console recovery and verified SSH access during security changes.
- Design any firewall policy around verified NetBird requirements before activation.
- Treat uploaded filenames and article input as untrusted and validate them.
- Do not execute content supplied in an article.
- Record deployment activity without logging tokens or sensitive configuration.

## 9. Proposed focused commit sequence

No commit or push is authorized by this draft. After review, the recommended local commit sequence is:

1. `docs: record blog discovery and implementation plan`
2. `build: migrate existing static site to Astro`
3. `feat: add bilingual article content model`
4. `feat: add localized SEO feeds and navigation`
5. `ops: add reproducible papabear processing baseline`
6. `feat: add local translation pipeline`
7. `feat: add bilingual article audio pipeline`
8. `feat: add private publishing interface`
9. `ops: add validated release assembly and recovery`
10. `docs: record approved Cloudflare deployment transition`

Each commit should be reviewed and tested before the next phase. Pushing branches, opening pull requests, merging, and deployment remain separate authorization points.

## 10. Immediate next step after approval

Create a focused local documentation commit containing only:

- `docs/PHASE_0_DISCOVERY.md`
- `docs/IMPLEMENTATION_PLAN.md`

After that commit is approved, begin Phase 1 with a read-only capture of the existing website behavior and reference screenshots before adding Astro.
