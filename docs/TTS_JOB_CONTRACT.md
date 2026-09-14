# TTS Article Job Contract

Status: validated contract; Azure Spanish and Kokoro English delivery approved

## Boundary

One job renders one final, reviewed article locale. Spanish and English run as separate jobs so each result is bound to its own text, language, and configured voice. The request never supplies a model path, executable, output directory, or arbitrary voice. Those values come from versioned server configuration.

## Request

The private publishing workflow supplies schema version 1, the stable article UUID, locale, lowercase SHA-256 source revision, final title, and ordered text segments. Segment IDs are unique and stable. Limits of 250 segments, 8,000 characters per segment, and 100,000 article characters reject unreasonable input before model execution.

The canonical narration text is the title followed by every segment in order, separated by blank lines and terminated by one newline. Its UTF-8 SHA-256 is the audio `textHash`. Any text edit or reordering therefore makes previous audio stale automatically.

## Result

A successful result must match the request's article ID, locale, source revision, and canonical text hash. It records the configured voice, configuration version, engine, pinned model revision, deterministic locale/article MP3 filename, generation time, file checksum, duration, byte size, codec, sample rate, channels, and bitrate.

The initial web format is normalized MP3 at 48 kHz, mono, and 128 kbps. The deterministic filename is `<locale>-<articleId>.mp3`; public placement is decided by the release pipeline, not the model worker.

## Atomic behavior

The worker writes to a private staging directory. It may publish a result only after FFprobe and contract validation pass. Failure publishes neither new metadata nor a replacement public MP3, preserving the last accepted audio and production release.

## Owner decision

The Spanish and English production voice IDs are intentionally not selected by this contract. The owner will choose them after listening to the fixed Kokoro samples. Recording that choice changes versioned voice configuration, not this request/result boundary.

The owner approved Azure `es-MX-JorgeMultilingualNeural` at 1.08× for Spanish and retained Kokoro `af_heart` for American English. Spanish uses the versioned NFL entity configuration and controlled English-language spans for names and untranslated game terminology. Canonical article text and its hash remain unchanged. The Azure worker accepts only Spanish requests, reads its credential from the server environment, normalizes output to the same web format as English, and publishes atomically only after contract validation. Future pronunciation corrections are versioned centrally and do not require article edits.

`config/tts/spanish-nfl-terms.json` is the machine-readable terminology reference. NFL Football Operations controls canonical football meaning, Spanish sources provide vocabulary discovery, and the owner-reviewed Fanaticosos policy controls neutral Latin-American usage. Only its explicit `ttsEntries` alter narration. The Azure compiler loads this file through `config/tts/azure-nfl-entities.json`.

## Audio policy revisions

Since 2026-09-14 the publisher keeps one policy revision per locale, stored on each audio job. A locale's audio is stale only when its own generation inputs change:

- Spanish (ElevenLabs): `config/tts/elevenlabs-production.json` minus `pronunciationVersion`, plus the approved `providerOverrides.elevenlabs.es` substitutions from `config/tts/pronunciations.json`.
- English (Kokoro): `config/tts/production.json` minus `pronunciationVersion`, plus the approved `overrides.en` substitutions.

Preflight references (`nfl-entities.json`, `azure-nfl-entities.json`, `spanish-nfl-terms.json`) and the pronunciation version counter never invalidate audio; they only affect the preflight report. Bumping `pronunciationVersion` is still required for the workers to accept the file, but it does not force regeneration unless a substitution the locale actually uses changed. Owner-uploaded Spanish MP3s are never policy-dependent. Audio generated before the split carries the former combined revision; it is treated as current while none of the inputs of that legacy formula change, so the split itself does not force a regeneration.

The fixed production router validates the request before selecting an engine. Spanish jobs alone retain the Azure environment and receive bounded outbound network access. English jobs route to the pinned offline Kokoro worker, and the router removes Azure credentials before replacing itself with that process. Neither caller can select an engine, voice, executable, model path, or output path.

## ElevenLabs quota preflight and block cache

Before the Spanish worker buys anything it computes the cost of the job: every narration block whose audio is not already in the private block cache, measured in characters as sent to ElevenLabs. It then reads the account balance from the ElevenLabs subscription endpoint and the private per-key ledger, and refuses to start when either cannot cover the whole job. The refusal is written to `failure.json` in Spanish with the numbers involved and states that no credit was consumed. While a job runs, `progress.json` reports the stage (`preflight`, `generating`, `assembling`, `completed`), block counters, and the quota numbers; the publisher exposes them for both the SQLite and filesystem stores.

- Account balance: `character_limit - character_count` from the subscription. This is authoritative.
- Key limit: ElevenLabs does not expose the optional per-key character limit through its API. The owner records it with `sudo /usr/local/sbin/fanaticosos-blog-admin set-elevenlabs-key-limit EXPECTED_COMMIT CHARACTERS` (stored as `ELEVENLABS_KEY_CHARACTER_LIMIT` in the root-only credential file; `0` removes it). The worker keeps a ledger under `cache/tts/elevenlabs/usage/<key fingerprint>.json` of characters it generated during the current billing cycle and resets it when the subscription's `next_character_count_reset_unix` advances. The ledger only counts this pipeline's own requests, so it is a lower bound on the key's real usage; keep the key limit at or above the expected monthly need and let the account balance be the hard stop.
- `elevenlabs-capacity-status EXPECTED_COMMIT` prints the account balance, the configured key limit, and the ledger for the installed key.
- Transient provider failures (HTTP 429, 500, 502, 503, 504, network) are retried up to three times with backoff. Rejections such as `quota_exceeded` or an invalid key are never retried; a rejected request is not billed.
- Block cache identity covers voice, model, output format, voice settings, the spoken text, and any stitching context. It deliberately excludes the pronunciation version counter: the spoken text already carries every substitution, so bumping the counter re-bills nothing. Blocks cached under the previous identity are migrated on first use.
- `voiceId` may be pinned in `config/tts/elevenlabs-production.json`; when present the worker skips the by-name voice lookup. Adding it changes the Spanish policy revision, so introduce it together with the next intentional voice change.
