# Papabear Processing Baseline

Status: Phase 3 implemented and verified on 2026-07-30

## Scope

This document defines the reproducible private processing baseline for the Fanaticosos blog. It does not authorize deployment, public access, Cloudflare changes, billing, translation-model installation, or TTS-model installation.

## Verified host facts

- Host: `papabear`
- Operating system: Ubuntu 24.04.4 LTS, amd64
- Compute: 12 vCPUs, 31 GiB usable RAM, 8 GiB swap
- Root filesystem: approximately 98 GiB, with approximately 83 GiB available at discovery
- Additional unallocated LVM capacity: approximately 397 GiB
- GPU runtime: none
- Private management: NetBird `100.121.48.92`
- SSH: key-only authentication verified
- Repository access: dedicated read-only GitHub deploy key for `fanaticosos/fanaticosos-web`
- AppArmor: enabled and active
- Automatic Ubuntu security updates: enabled
- Firewall: UFW remains unchanged during Phase 3

## Node.js decision

### Verified facts

- The project requires Node `>=24 <25` and `.nvmrc` specifies major version 24.
- Ubuntu 24.04 offers Node 18.19.1 and npm 9.2.0, which do not satisfy the project requirement.
- Node 24 is Active LTS and has a published end-of-life date of April 2028.
- The current official Node 24 release at selection time is `v24.18.0`.
- Official artifact: `node-v24.18.0-linux-x64.tar.xz`
- Published SHA-256:

```text
55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
```

### Recommendation

Install the pinned official Node archive under:

```text
/opt/nodejs/node-v24.18.0
```

Maintain a root-owned version selector:

```text
/opt/nodejs/current -> /opt/nodejs/node-v24.18.0
```

Project commands and future systemd units will use `/opt/nodejs/current/bin` explicitly in `PATH`. Ubuntu `nodejs` and `npm` packages will not be installed, and no third-party Node package repository will be added.

Every installation or upgrade must download the versioned archive and official `SHASUMS256.txt`, verify the exact checksum, and stop on any mismatch before extraction.

## Ubuntu-managed baseline packages

The installed package set is intentionally small:

- `ffmpeg` — provides FFmpeg and ffprobe
- `python3-venv` — isolated Python environments
- `python3-dev` — Python headers for approved native dependencies
- `build-essential` — compiler and standard build tools for approved native dependencies

Already installed and retained:

- `git`
- `curl`
- `ca-certificates`
- `jq`
- `python3`

Translation- or TTS-specific native libraries will be considered only after a benchmark candidate demonstrates that they are required.

## Dedicated account

Dedicated account:

```text
fanaticosos-blog
```

Properties:

- system account and system group;
- no password;
- no interactive shell;
- no sudo membership;
- home and complete project root at `/opt/fanaticosos-blog`;
- owns only project source, work, model, cache, generated-media, and release content that requires write access;
- cannot read `sysadmin` SSH or other unrelated credentials.

Interactive maintenance will be performed by `sysadmin` through narrowly scoped `sudo -u fanaticosos-blog` commands. A login shell will not be enabled.

## Directory layout

```text
/opt/fanaticosos-blog/
├── repository/          # Git working copy
├── releases/            # Immutable validated release directories
├── generated/audio/     # Generated MP3 files; never committed
├── jobs/                # Private bounded translation/TTS job directories
├── models/              # Downloaded translation and TTS models
├── runtimes/            # Isolated Python environments
├── tools/               # Pinned private executable runtimes
├── state/               # Job state and release manifests
├── work/                # Staging and temporary job work
└── cache/               # Reproducible npm, pip, and model-download caches
```

`/opt/fanaticosos-blog` is the single project backup and restore boundary. A full backup includes the complete tree with ownership, permissions, links, and private files preserved. `cache/` may be excluded when reducing backup size because it is reproducible. Host integration outside this tree—principally the root-owned systemd unit, restricted administration helper, sudoers rule, and required Ubuntu packages—must be recreated from the repository deployment documentation after restoring the project tree.

Logging will use the system journal initially. A separate `/var/log` tree will be added only if measured retention or export requirements justify it.

## Ownership and permissions

- `/opt/nodejs` is root-owned and not writable by the service account.
- Project runtime directories are owned by `fanaticosos-blog:fanaticosos-blog` and are not world-writable.
- Backup destinations and encryption credentials are root-controlled and unreadable by the service account. Backup archives preserve the service-owned project tree without being stored inside it.
- Releases become read-only after validation.
- Secrets will be stored outside Git with restrictive permissions during the later phase that first requires them.

## Installation order

1. Reconfirm host identity, package indexes, pending upgrades, disk, SSH, and NetBird.
2. Install only the approved Ubuntu baseline packages.
3. Download and checksum-verify Node `v24.18.0` in a temporary directory.
4. Install Node under `/opt/nodejs` with root ownership.
5. Create the dedicated system account and directory layout.
6. Clone the repository only after the Git deploy credential design is approved.
7. Install repository dependencies as the service account using `npm ci`.
8. Build and validate Astro as the service account.
9. Run an FFmpeg/ffprobe audio round-trip test.
10. Record resource use and verify SSH, NetBird, AppArmor, and unrelated services remain healthy.

## Safeguards

- Do not alter UFW or NetBird during this phase.
- Do not install Docker or Podman unless a later measured requirement justifies it.
- Do not add a public listener or editor service.
- Do not install models during the processing-baseline phase.
- Do not configure Wrangler or Cloudflare credentials during this phase.
- Do not enable a new systemd service until the equivalent command works interactively and predictably.
- Stop on checksum, package, permission, build, or health-check failure.

## Phase 3 acceptance checks

- Node and npm report the pinned Node 24 installation from `/opt/nodejs/current/bin`.
- FFmpeg and ffprobe complete an audio generation/probe/decode round trip.
- A Python virtual environment can be created without using system Python packages globally.
- The service account cannot use sudo, log in interactively, or read unrelated credentials.
- The Astro repository installs with `npm ci` and builds successfully as the service account.
- No public listener is introduced.
- SSH, NetBird, AppArmor, unattended upgrades, and existing services remain healthy.
- Rebuild steps are documented with exact versions and checksums.

## Verified completion record

- Node `v24.18.0` and npm `11.16.0` run from `/opt/nodejs/current/bin`.
- Ubuntu packages installed: `build-essential` `12.10ubuntu1`, `ffmpeg` `7:6.1.1-3ubuntu5`, `python3-dev` `3.12.3-0ubuntu2.1`, and `python3-venv` `3.12.3-0ubuntu2.1`.
- Python `3.12.3` created an isolated virtual environment, and FFmpeg generated, probed, and decoded a test MP3 successfully.
- The `fanaticosos-blog` account cannot use passwordless sudo and has no interactive login shell.
- GitHub accepted the repository-specific deploy key, and read-only repository access succeeded.
- The repository is checked out cleanly at `feature/multilingual-audio-blog`, commit `ca66ec81394b3b182e3c3d4a63e3bd5189a1fcf9`.
- `npm ci` installed 287 locked packages with zero reported vulnerabilities.
- The Astro production build completed with zero errors, warnings, or hints; content, settings, routes, and 12 output files passed validation.
- No persistent project process or new public listener was introduced.
- SSH, NetBird, AppArmor, unattended upgrades, and the host remained healthy after the build.
- Final measured root usage was 12 GiB of 98 GiB, with 81 GiB available; 31 GiB RAM and 8 GiB swap remained available for later model benchmarks.

## Information deferred to later phases

- Final storage placement after model and audio measurements; the root filesystem is sufficient for the baseline only.
- Model-specific Python packages and native libraries.
- Retention limits for models, build work, releases, logs, and generated audio.
- TTS-specific systemd boundaries and resource limits. The translation boundary is documented in `docs/TRANSLATION_DEPLOYMENT.md`.
- NetBird-aware UFW rules and required NetBird ports; UFW remains unchanged and inactive pending a separately approved firewall design.
