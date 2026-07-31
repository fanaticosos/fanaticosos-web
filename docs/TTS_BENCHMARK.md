# Fanaticosos TTS benchmark

Status: Initial Kokoro production voices and broadcast delivery approved

## Candidate

The first benchmark used `hexgrad/Kokoro-82M`, an Apache-2.0 model with 82 million parameters. Its untuned output was not acceptable: NFL names were incorrect in Spanish and its English voices had limited character. The selected profiles now form the initial production baseline; pronunciation improvements remain versioned configuration changes rather than a publication blocker.

Primary sources:

- https://github.com/hexgrad/kokoro
- https://huggingface.co/hexgrad/Kokoro-82M
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md

The official voice inventory warns that non-English support can be thinner than English support. Spanish quality is therefore an acceptance question, not an assumption.

## Owner-approved initial production baseline

- Latin-American Spanish target: `em_alex`
- American English target: `af_heart`
- Delivery profile: `broadcast` for both languages (`1.02` speed, 0.16-second pause)
- Spanish narration applies centralized Latino sports-broadcast pronunciations without changing visible article text.
- Configuration status: `approved`

The owner accepted the Latino delivery profile as the initial production baseline after comparing the available Spanish voices. The system may improve recurring NFL pronunciations centrally without requiring article-by-article work.

The owner accepted the English `af_heart` long-form review on 2026-07-30 and selected `latino-em_alex` for initial Spanish production. The centralized dictionary is the single narration source; articles do not carry routine pronunciation instructions. Canonical NFL names remain separate from engine-specific synthesis instructions, and future corrections increment the pronunciation version without reopening voice selection.

## Version 1 comparison voices

- Spanish: `ef_dora`, `em_alex`, `em_santa`
- American English: `af_heart`, `af_bella`

The English candidates were the official inventory's two highest-rated American-English voices. The generic Spanish candidate set was insufficient: Fanaticosos requires Latin-American Spanish, explicitly `es-419`, and must not use a Spain-Spanish voice such as `em_santa`.

## Required locale variants

- Spanish narration: `es-419` (Latin American Spanish)
- English narration: `en-US` (American English)

Generic `es` support is not an acceptance criterion. A future engine must demonstrate a Latin-American voice and natural American-English pronunciation for embedded NFL teams, cities, players, stadiums, abbreviations, and football terminology.

Mexican-broadcast pronunciation references are tracked separately from active
pronunciation overrides. `config/tts/mexican-broadcast-sources.json` records
Primero y Diez's dedicated NFL team-name series as editorial evidence for 30
teams and explicitly records the two current coverage gaps. A source reference
never activates a pronunciation; only an approved entry in
`config/tts/pronunciations.json` can alter narration.

## Listening fixture

`benchmarks/tts/es-en.json` gives every candidate the same language-appropriate NFL passage. It tests names, teams, scores, passing statistics, English terms inside Spanish reporting, stadium names, abbreviations, football terminology, sentence pacing, and paragraph-length narration.

## Required measurements

For every voice, record:

- pinned model and runtime revisions;
- model and voice checksums;
- wall time and peak memory;
- source duration and generated-audio duration;
- real-time factor;
- sample rate, channels, codec, and decoded integrity;
- normalized MP3 duration, size, bitrate, and loudness;
- owner rating for pronunciation, naturalness, pacing, and listening comfort.

No candidate becomes the production voice until the owner listens to generated samples. No generated audio or downloaded model belongs in Git.

## Isolated runtime

The candidate runtime uses Python 3.12 in `/opt/fanaticosos-blog/runtimes/tts-benchmark-kokoro-v1`. Direct Python requirements are pinned in `config/tts/kokoro-benchmark-requirements.txt`; the complete resolved environment is recorded privately after installation. The requirements explicitly select PyTorch's CPU wheel because Papabear has no GPU and the default Linux package can resolve unnecessary CUDA dependencies. Ubuntu provides `espeak-ng`, which the official Kokoro documentation requires for Spanish and fallback pronunciation.

Installing this runtime does not approve Kokoro, download its model or voices, generate audio, or create a persistent process. Those remain separate acceptance steps.

## Pinned candidate files

Candidate file metadata is pinned in `config/tts/kokoro-candidate-files.json` at official model revision `f3ff3571791e39611d31c381e3a41a3af07b4987`. The downloader permits only the model configuration, model weights, and the five benchmark voices. It verifies every byte count and SHA-256 in a private staging directory and publishes the directory atomically only after all files pass.
