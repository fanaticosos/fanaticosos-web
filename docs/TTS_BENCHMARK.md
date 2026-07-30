# Fanaticosos TTS benchmark

Status: candidate definition; no voice is approved yet

## Candidate

The first benchmark uses `hexgrad/Kokoro-82M`, an Apache-2.0 model with 82 million parameters. The official inference library supports CPU execution, produces 24 kHz audio, and uses `espeak-ng` for Spanish and out-of-dictionary fallback.

Primary sources:

- https://github.com/hexgrad/kokoro
- https://huggingface.co/hexgrad/Kokoro-82M
- https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md

The official voice inventory warns that non-English support can be thinner than English support. Spanish quality is therefore an acceptance question, not an assumption.

## Version 1 voices

- Spanish: `ef_dora`, `em_alex`, `em_santa`
- American English: `af_heart`, `af_bella`

The English candidates are the official inventory's two highest-rated American-English voices. All three available Spanish voices are retained because the inventory does not publish comparable grades for them.

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

The candidate runtime uses Python 3.12 in `/var/lib/fanaticosos-blog/venvs/tts-benchmark-kokoro-v1`. Direct Python requirements are pinned in `config/tts/kokoro-benchmark-requirements.txt`; the complete resolved environment is recorded privately after installation. Ubuntu provides `espeak-ng`, which the official Kokoro documentation requires for Spanish and fallback pronunciation.

Installing this runtime does not approve Kokoro, download its model or voices, generate audio, or create a persistent process. Those remain separate acceptance steps.
