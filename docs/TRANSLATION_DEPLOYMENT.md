# Translation Worker Deployment

Status: Installed and bounded-worker integration verified on `papabear` on 2026-07-30

## Selected runtime

- Engine: llama.cpp `b10195` (`47f686f53`)
- Model: `Qwen/Qwen3-8B-GGUF`
- Revision: `7c41481f57cb95916b40956ab2f0b139b296d974`
- File: `Qwen3-8B-Q4_K_M.gguf`
- SHA-256: `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785`
- Worker: `scripts/translation/translate_article_qwen.py`
- Contract: `docs/TRANSLATION_JOB_CONTRACT.md`

## Versioned and installed unit

The versioned source is:

```text
/srv/fanaticosos-blog/repository/deploy/systemd/fanaticosos-translation@.service
```

The installed root-owned copy is:

```text
/etc/systemd/system/fanaticosos-translation@.service
```

Installation uses `root:root` ownership and mode `0644`, followed by `systemctl daemon-reload`. The installed file must compare byte-for-byte with the versioned source and pass `systemd-analyze verify` without diagnostics.

The template is static: it is not enabled, scheduled, or persistent. A prepared private job starts one instance explicitly.

## Job layout

Each job has a safe identifier and a private directory:

```text
/var/lib/fanaticosos-blog/jobs/<job-id>/
├── request.json
└── result.json
```

The directory is owned by `fanaticosos-blog:fanaticosos-blog` with mode `0700`. The request and successful result use mode `0600`. `result.json` is absent until the complete translation passes structural, protected-value, number, proper-name, and glossary validation.

The private editor will prepare requests and start instances using a narrowly scoped mechanism designed in Phase 6. It must never accept a caller-supplied executable, model path, repository path, or arbitrary systemd unit name.

## Automatic execution boundaries

Every instance receives:

- five-minute maximum runtime;
- 16 GiB memory ceiling;
- 1 GiB swap ceiling;
- `KillMode=control-group`;
- no automatic restart;
- no network access;
- private `/tmp`;
- no privilege gain;
- read-only host filesystem except the exact job directory;
- dedicated non-login service account;
- pinned model, runtime, glossary, and worker arguments.

Failure leaves the accepted English article and public site unchanged. Operations inspect concise unit state and journal output; the owner does not monitor RAM, CPU, swap, or processes.

## Verified integration result

The installed template processed job `verification-0001` successfully:

- wall time: 44 seconds;
- unit result: `success`;
- worker exit status: `0`;
- effective memory limit: 17,179,869,184 bytes;
- effective swap limit: 1,073,741,824 bytes;
- result mode: `0600`;
- no remaining worker or llama.cpp process;
- host remained healthy;
- repository remained clean.

The verified translations were:

```text
The Bears Defeat Green Bay 27-24 in Chicago
Caleb Williams threw a touchdown pass and the defense forced a fumble in the red zone.
```

## Remaining Phase 4 gates

- Process a representative full article through the installed template.
- Present the generated English draft in the private editor and record owner acceptance or correction.
- Connect accepted result segments to the English Markdown article without allowing the model to edit Git directly.

These gates do not require another model-selection benchmark.
