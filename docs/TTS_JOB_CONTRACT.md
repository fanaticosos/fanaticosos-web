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

The fixed production router validates the request before selecting an engine. Spanish jobs alone retain the Azure environment and receive bounded outbound network access. English jobs route to the pinned offline Kokoro worker, and the router removes Azure credentials before replacing itself with that process. Neither caller can select an engine, voice, executable, model path, or output path.
