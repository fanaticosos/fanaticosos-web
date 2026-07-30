# Translation Benchmark

Status: Phase 4 selection complete; production integration pending

## Objective

Measure Spanish-to-English NFL and Chicago Bears journalism quality, CPU processing time, memory use, storage use, and repeatability on `papabear` without using a paid API.

## Initial candidates

1. [`Helsinki-NLP/opus-mt-es-en`](https://huggingface.co/Helsinki-NLP/opus-mt-es-en) is the lightweight baseline. Its model card identifies Spanish-to-English translation, an Apache-2.0 license, and published news-test results.
2. [`google/madlad400-3b-mt`](https://huggingface.co/google/madlad400-3b-mt) is the higher-capacity quality candidate. Its model card identifies multilingual machine translation and an Apache-2.0 license. Its larger size is expected to require materially more memory and CPU time, which must be measured rather than assumed acceptable.
3. [`Qwen/Qwen3-8B-GGUF`](https://huggingface.co/Qwen/Qwen3-8B-GGUF), using the official `Q4_K_M` quantization and pinned llama.cpp runtime, is the selected quality candidate. Its Apache-2.0 license, local execution, instruction following, and glossary handling fit the project requirements.

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

`config/translation/glossary.json` centralizes Spanish-to-English NFL terminology and protected names. The official NFL Football Operations glossary and current NFL rulebook are the primary terminology authorities. Wikipedia's American-football glossary is used only to discover vocabulary that must then be mapped and validated against NFL usage. Routine publishing will apply this configuration automatically; the owner will not maintain glossary fields for every article.

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

## Verified results and owner decision

The owner selected Qwen3 8B Q4 for production integration on 2026-07-30.

### OPUS-MT baseline

- Pinned model: `Helsinki-NLP/opus-mt-es-en` revision `c96e2c5399ebfae4fc43d9669556b9afa74bb69d`.
- Installed size: approximately 301 MB.
- Full two-pass benchmark time: approximately 21 seconds.
- Peak memory: approximately 687 MiB.
- Result: reliable and inexpensive, but rejected for publication quality because it mistranslated multiple NFL terms despite glossary validation.

### MADLAD-400 3B

- Pinned model: `google/madlad400-3b-mt` revision `fa184c675da0b5c9e1c8694fccd4e12e2d422094`.
- Official weight size: 11,761,587,872 bytes; SHA-256 verified.
- Full two-pass benchmark time: approximately 5.5 minutes.
- Peak memory: approximately 11 GiB.
- Result: better capacity than OPUS-MT but still produced unacceptable NFL terminology errors and was rejected.

### Qwen3 8B Q4_K_M

- Pinned model: `Qwen/Qwen3-8B-GGUF` revision `7c41481f57cb95916b40956ab2f0b139b296d974`.
- Model file: `Qwen3-8B-Q4_K_M.gguf`.
- Exact size: 5,027,783,488 bytes.
- Verified SHA-256: `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`.
- Pinned runtime: llama.cpp `b10195` (`47f686f53`).
- Two preserved full-case outputs were byte-for-byte identical and preserved the tested names, scores, and NFL terminology.
- Two sentences still required normal editorial correction for idiomatic English. Automated translation is therefore a draft-generation step, not final editorial authority.
- A bounded single-sentence verification completed successfully in 14 seconds, exited normally, created mode-`0600` output, left no process behind, and kept the host healthy.

The earlier Qwen benchmark failures were traced to two harness defects rather than model crashes: Python buffered unbounded child output, and llama.cpp remained available for another conversational turn after generating its answer. The runner now sends console output away from memory and supplies `--single-turn`.

## Production integration requirements

Qwen may enter the publishing workflow only through a bounded transient systemd service with:

- a 16 GiB memory ceiling;
- a 1 GiB swap ceiling;
- a five-minute initial runtime ceiling, adjustable only from measured full-article evidence;
- control-group termination so children cannot survive a timeout or failure;
- no persistent model listener;
- private mode-`0600` working output;
- structured input and output with stable segment identifiers;
- automatic validation of names, teams, scores, statistics, quotations, and glossary terms;
- atomic replacement only after the complete translation passes validation;
- preservation of the previous accepted English revision after any failure;
- owner preview and correction before publication.

Routine publishing must not require the owner to inspect RAM, CPU, swap, processes, or logs. A failed job must stop automatically and present a concise editor-facing error.

## Safety gate

- Pin model revisions and Python dependencies before integration.
- Download models only as `fanaticosos-blog` into the dedicated model/cache locations.
- Do not add credentials, models, benchmark outputs, or generated translations to Git.
- Do not expose a listener, create a system service, publish, or modify Cloudflare during benchmarking.
- A failed benchmark must leave the accepted bilingual fixture and current website unchanged.
