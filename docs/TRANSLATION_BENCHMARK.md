# Translation Benchmark

Status: Phase 4 benchmark design; no model selected or installed

## Objective

Measure Spanish-to-English NFL and Chicago Bears journalism quality, CPU processing time, memory use, storage use, and repeatability on `papabear` without using a paid API.

## Initial candidates

1. [`Helsinki-NLP/opus-mt-es-en`](https://huggingface.co/Helsinki-NLP/opus-mt-es-en) is the lightweight baseline. Its model card identifies Spanish-to-English translation, an Apache-2.0 license, and published news-test results.
2. [`google/madlad400-3b-mt`](https://huggingface.co/google/madlad400-3b-mt) is the higher-capacity quality candidate. Its model card identifies multilingual machine translation and an Apache-2.0 license. Its larger size is expected to require materially more memory and CPU time, which must be measured rather than assumed acceptable.

[`facebook/nllb-200-distilled-600M`](https://huggingface.co/facebook/nllb-200-distilled-600M) is excluded from the initial deployment shortlist because its model card uses CC-BY-NC-4.0, describes research as the intended use, and says it is not released for production deployment. This avoids building the publishing workflow around a model with an unsuitable deployment posture.

## Benchmark data

`benchmarks/translation/es-en.json` contains synthetic, non-published NFL examples covering:

- headlines;
- game recaps and quarterback statistics;
- offensive and defensive analysis;
- quotations;
- downs, drives, formations, positions, turnovers, and field conditions;
- Chicago Bears, NFC North teams, people, stadiums, and league abbreviations;
- idioms and NFL terminology;
- scores, yardage, passing statistics, and game situations;
- paragraph-level journalistic flow.

`config/translation/glossary.json` centralizes standard terminology and protected names. Routine publishing will apply this configuration automatically; the owner will not maintain glossary fields for every article.

## Measurement protocol

Each candidate must process the identical ordered cases after a cold start and a warm start. Record:

- exact model identifier, revision, license, and downloaded bytes;
- exact runtime and dependency versions;
- model-load time and translation time;
- peak resident memory;
- output for every case;
- automatic preservation failures for names, scores, minutes, statistics, and `VAR`;
- whether glossary application changes the raw output;
- owner quality rating after side-by-side review.

The benchmark must not edit article source files or production output. Results belong under `/var/lib/fanaticosos-blog/work` until the selected integration and its provenance format are approved.

## Selection rule

Quality is the first selection criterion, followed by reliability and zero recurring service cost. Processing time is acceptable if it supports a simple draft-preview-publish workflow on the existing CPU-only host. No candidate is selected until the owner reviews the translated samples.

## Safety gate

- Pin model revisions and Python dependencies before integration.
- Download models only as `fanaticosos-blog` into the dedicated model/cache locations.
- Do not add credentials, models, benchmark outputs, or generated translations to Git.
- Do not expose a listener, create a system service, publish, or modify Cloudflare during benchmarking.
- A failed benchmark must leave the accepted bilingual fixture and current website unchanged.
