# FanaticOSOS V2 Architecture Contract

**Status:** Accepted implementation baseline

**Date:** 2026-09-09

**Scope:** Private publisher orchestration, artifacts, releases, deployments, and weekly music

## 1. Decision

FanaticOSOS V2 retains Astro, the existing Node publisher, Qwen, ElevenLabs,
Kokoro, bounded systemd workers, Cloudflare Pages, and NetBird.

SQLite is the sole authority for workflow state. The filesystem stores large
immutable artifacts and release trees. A file's existence never proves that a
workflow step completed; an accepted database record with a verified checksum
does.

The migration must be incremental. Existing JSON state remains readable until
its subsystem has been migrated and verified. A migrated subsystem must not
dual-write authoritative state to JSON and SQLite.

## 2. Ownership boundaries

| Concern | Authority |
|---|---|
| Article identity and current revision | SQLite |
| Owner-entered revision content and metadata | SQLite |
| Job lifecycle, leases, retries, and checkpoints | SQLite |
| Artifact identity, dependency, status, path, and checksum | SQLite |
| MP3, images, model output, and generated files | Filesystem |
| Release manifest and validation result | SQLite |
| Immutable release contents | Filesystem |
| Active article catalog | SQLite |
| Site-settings revision, including weekly music | SQLite |
| Deployment target and verification result | SQLite |
| Process execution and resource limits | systemd |

systemd runs bounded processes. It is not part of the application state
machine. A unit state alone must never determine what the publisher UI reports.

## 3. Minimum schema

The first schema contains these tables:

- `schema_migrations`: ordered, checksummed migrations.
- `articles`: stable article identity and current revision reference.
- `revisions`: immutable owner-content snapshots.
- `artifacts`: generated files and accepted-state metadata.
- `jobs`: durable work, leases, attempts, checkpoints, and errors.
- `article_catalogs`: immutable sets of published article revisions.
- `site_settings_revisions`: immutable site settings, independent of articles.
- `releases`: immutable pairing of one catalog and one settings revision.
- `release_artifacts`: exact artifact membership and checksums.
- `deployments`: release, Cloudflare identifiers, verification, and rollback.

SQLite requirements:

- foreign keys enabled on every connection;
- WAL journal mode;
- explicit migrations with no runtime auto-repair;
- transactions for every state transition;
- timestamps stored as UTC ISO-8601 text;
- application-level constrained text states backed by database `CHECK`
  constraints;
- database backups use SQLite's online backup mechanism, not raw file copying
  while the publisher is running.

## 4. Independent states

Do not create one giant workflow enum. These objects have independent states:

| Object | States |
|---|---|
| Revision | `draft`, `review`, `ready`, `superseded` |
| Artifact | `pending`, `generated`, `reviewed`, `accepted`, `superseded`, `failed` |
| Job | `queued`, `leased`, `retry_wait`, `completed`, `failed`, `cancelled` |
| Release | `building`, `validated`, `failed` |
| Deployment | `queued`, `uploading`, `verifying`, `published`, `failed`, `rolled_back` |

The UI derives readiness from these records. It must show the failed or stale
dependency and the recovery action instead of presenting an unexplained disabled
button.

## 5. Artifact dependency and invalidation rules

Accepted artifacts are immutable. Invalidation marks an artifact superseded; it
does not modify or delete the artifact.

| Owner change | Translation | Spanish audio | English audio | Featured image |
|---|---|---|---|---|
| Spanish title or body | supersede | supersede | supersede | preserve |
| English correction | preserve corrected English artifact | preserve | supersede | preserve |
| Description/SEO summary | preserve | preserve | preserve | preserve |
| Category, season, or tags | preserve | preserve | preserve | preserve |
| Featured image or image metadata | preserve | preserve | preserve | replace image artifact |
| Weekly song | preserve | preserve | preserve | preserve |
| TTS pronunciation/provider policy | preserve | supersede affected locale only | supersede affected locale only | preserve |

Dependency hashes, not generic draft revision numbers, determine freshness.
Translation depends on Spanish title/body. Each narration depends on its spoken
text and locale-specific TTS policy. An image depends only on its bytes and image
metadata.

## 6. Job contract

Every expensive or external operation is represented by one `jobs` row before
execution begins. A job includes a stable idempotency key, type, dependency
reference, attempt count, lease owner, lease expiry, heartbeat, checkpoint,
timestamps, and a sanitized error.

- Repeated requests with the same idempotency key return the existing job.
- A worker claims a job transactionally and receives a bounded lease.
- Only the lease owner may heartbeat, checkpoint, complete, or fail the job.
- Expired leases become claimable without manual filesystem cleanup.
- Translation checkpoints after each validated batch and resumes at the first
  incomplete batch.
- Retries use bounded deterministic backoff and never create duplicate accepted
  artifacts.
- Reconciliation may observe systemd and artifact files, but only a database
  transaction changes authoritative state.

## 7. Release and deployment contract

An article catalog is immutable once created. A site-settings revision is
immutable once created. A release combines exactly one catalog with exactly one
site-settings revision and records every included artifact checksum.

Building a release:

1. resolves only accepted artifacts;
2. writes into a new release directory;
3. validates routes, navigation, localized content, images, and media;
4. stores the manifest and checksums;
5. marks the release `validated` in one transaction.

A validated release never mutates. Publishing always means “publish release X,”
not “reconstruct the latest state.” Deployment records the exact release and
Cloudflare deployment identifiers. Production is successful only after the
homepage, localized routes, both MP3s, immutable deployment URL, apex domain,
`www`, and Pages hostname match the manifest. Failed convergence triggers the
existing bounded rollback protection and records its result.

## 8. Weekly-music isolation

Changing the weekly song creates a new `site_settings_revisions` row and a new
release paired with the currently active article catalog. It must not select an
old article release directory, regenerate article artifacts, or alter the active
catalog. Tests must prove that article identities, routes, images, and audio
checksums are unchanged across a music-only release.

## 9. Migration order

1. Add the database adapter, migrations, backup/restore verification, and schema
   tests without changing the owner workflow.
2. Import drafts and move draft writes to SQLite.
3. Move translation state and accepted translation artifacts.
4. Move locale-independent TTS state and accepted audio artifacts.
5. Move preview readiness, releases, and deployments.
6. Move weekly music into independent site-settings revisions.
7. Replace filesystem admission with durable jobs, leases, and checkpoints.
8. Remove legacy JSON writes only after migration and rollback tests pass.

Each step must be independently deployable and reversible. No step may require a
flag day migration of every subsystem.

## 10. Acceptance contract

Automation must cover:

- create, save, reopen, translate, accept, narrate, preview, build, publish, and
  verify a bilingual article;
- unchanged save preserves accepted work;
- image-only and metadata-only edits preserve translation and audio;
- Spanish text edits invalidate only their declared dependents;
- English corrections invalidate English audio only;
- duplicate clicks create one logical job;
- publisher or worker restart resumes leased/checkpointed work;
- malformed Qwen output fails one batch recoverably;
- ElevenLabs quota/network failure exposes a safe retry action;
- release retention never removes active-release artifacts;
- weekly-music publication preserves the active article catalog exactly;
- Cloudflare mismatch fails verification and records rollback;
- the publisher explains every blocked action without requiring SSH.

The system is not considered repaired after one successful publication. Final
acceptance requires repeated unattended publishing, editing, weekly-song changes,
restart/failure recovery, exact production verification, and one full week with
no manual state repair or service restart.
