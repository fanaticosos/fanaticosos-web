# TTS Article Job Contract

Status: validated contract; voices and broadcast delivery selected, production approval pending

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

## Pending owner decision

The Spanish and English production voice IDs are intentionally not selected by this contract. The owner will choose them after listening to the fixed Kokoro samples. Recording that choice changes versioned voice configuration, not this request/result boundary.

The owner selected `em_alex` for Latin-American Spanish tuning and `af_heart` for American English, with the broadcast profile for both. Spanish narration applies the centralized pronunciation dictionary before synthesis; canonical article text and its hash remain unchanged. `config/tts/production.json` remains `selected-for-tuning`, so the worker rejects production execution before loading Kokoro. The systemd template accepts neither a voice nor pronunciation overrides from a caller; only versioned repository configuration controls them, and only an explicit later owner approval may change the status to `approved`.
