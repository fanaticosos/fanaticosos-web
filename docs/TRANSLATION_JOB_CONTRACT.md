# Translation Job Contract

Status: Phase 4 production-worker contract
Version: 1

## Purpose

The private editor submits Spanish article content as ordered, typed segments. The translation worker returns the same identifiers in the same order with English draft text and complete provenance. Qwen never edits repository article files directly.

## Request

```json
{
  "schemaVersion": 1,
  "articleId": "00000000-0000-4000-8000-000000000001",
  "sourceLocale": "es",
  "targetLocale": "en",
  "segments": [
    {
      "id": "title",
      "kind": "title",
      "text": "Los Bears ganan en Chicago",
      "preserve": ["Bears", "Chicago"]
    },
    {
      "id": "body-001",
      "kind": "paragraph",
      "text": "Caleb Williams lanzó dos pases de anotación."
    }
  ]
}
```

Supported segment kinds are `title`, `description`, `heading`, `paragraph`, `quote`, `list-item`, and `caption`. The editor creates stable identifiers and automatically supplies exceptional protected values; routine NFL terminology comes from the centralized glossary.

The contract permits at most 512 segments, 12,000 characters per segment, and 250,000 characters per article. These are input-safety limits. The worker groups a typical article into one bounded model invocation and splits unusually large articles only when required.

Production configuration version 8 limits a model batch to 12,000 source characters, includes only glossary entries and protected names relevant to that batch, accepts the model's validated bare-array response, and applies inflection-aware terminology checks. A typical article therefore loads the 5 GB model once instead of once per small batch while preserving segment order. It provides a short Spanish-to-English JSON demonstration before the article payload so the model follows the translation task instead of copying the Spanish article. If one translated segment fails validation, the worker makes one focused correction attempt for that segment and validates it again; it still publishes nothing unless every segment passes.

Glossary version 5 also enforces reviewed editorial phrases where a literal but technically valid translation would sound unnatural in American NFL journalism, including `serie ofensiva` as `drive` and `complicó los despejes` as `made punting difficult`.

## Successful result

```json
{
  "schemaVersion": 1,
  "articleId": "00000000-0000-4000-8000-000000000001",
  "sourceRevision": "<canonical-request-sha256>",
  "engine": "llama.cpp",
  "model": "Qwen/Qwen3-8B-GGUF",
  "modelRevision": "7c41481f57cb95916b40956ab2f0b139b296d974",
  "runtimeVersion": "b10195-47f686f53",
  "configurationVersion": "1",
  "glossaryVersion": 4,
  "generatedAt": "<UTC ISO-8601 timestamp>",
  "segments": [
    {
      "id": "title",
      "translation": "The Bears win in Chicago"
    },
    {
      "id": "body-001",
      "translation": "Caleb Williams threw two touchdown passes."
    }
  ]
}
```

`sourceRevision` is the SHA-256 of the normalized canonical request. It makes stale English output detectable after any Spanish content change.

## Failure behavior

- Invalid or oversized input is rejected before model execution.
- Missing, duplicate, reordered, or empty result segments fail validation.
- A mismatched article ID or source revision fails validation.
- Model output remains temporary until all preservation, glossary, and structure checks pass.
- A model-response parsing or validation failure preserves only the final bounded raw response in private mode-`0600` `failed-output.json` for diagnosis; it is never published.
- Only a complete validated result may atomically replace a draft translation result.
- A failure never changes the accepted English article or public site.
- The editor receives a concise error; the owner does not inspect system resources or processes.

## On-demand execution boundary

`deploy/systemd/fanaticosos-translation@.service` is the versioned production template. A job identifier maps to a private directory under `/opt/fanaticosos-blog/jobs/` containing `request.json` and, only after success, `result.json`.

The template is intentionally not enabled and does not run a persistent model listener. The future private publishing workflow starts one instance for a prepared job. systemd applies the approved five-minute runtime, 16 GiB memory, 1 GiB swap, control-group cleanup, private network, read-only host filesystem, and mode-`0600` output boundaries automatically.

Installing the template into `/etc/systemd/system` and authorizing the private editor to start instances are separate deployment actions requiring owner approval and server-side verification.
