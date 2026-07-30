# Fanaticosos Blog — Phase 0 Discovery

Status: Draft for owner review
Discovery date: 2026-07-29
Repository: `fanaticosos/fanaticosos-web`
Working branch: `feature/multilingual-audio-blog`

## 1. Project boundary

### Owner decisions

- This blog is a separate project from Fanaticoso Stream, under the same Fanaticosos brand.
- The existing public website appearance, branding, logo, and logo animation must be preserved.
- Existing Substack content will not be migrated.
- Spanish is the authoritative writing language.
- Each published article will have a complete English version, including page content, metadata, URL, and audio.
- The language control will switch the complete article, not audio alone.
- Publishing must remain simple: write the Spanish article once, preview it, and publish it without manually translating or creating audio.
- Recurring cost must remain at or near zero. No billing may be enabled without owner authorization.
- Production must not be modified or deployed without owner authorization.

### Scope conclusion

The first release extends the existing Fanaticosos website with an original multilingual sports journalism blog. It does not replace the existing site or migrate the Substack archive.

## 2. Existing website and repository

### Verified facts

- GitHub organization/account: `fanaticosos`.
- Repository: `fanaticosos/fanaticosos-web`.
- Production branch: `main`.
- Verified production commit during discovery: `13bd722` (`Fix logo path, add contact and terms pages`).
- The repository currently contains a plain static website:
  - `.gitignore`
  - `index.html`
  - `logo.png`
  - `pages/contact.html`
  - `pages/terms.html`
- There is currently no framework, package manager configuration, automated test suite, build configuration, or GitHub Actions workflow.
- The existing visual language uses navy and orange, Bebas Neue and Inter fonts, responsive cards, and a floating/glowing logo effect.
- The local repository uses the SSH remote `git@github-fanaticosos:fanaticosos/fanaticosos-web.git`.
- Authentication through the dedicated GitHub SSH alias was verified as the `fanaticosos` account.
- No write-access test, push, pull request, or production deployment was performed during discovery.

### Recommendation

Migrate the static pages to Astro in an isolated branch while reproducing the current appearance and effects. Visual parity must be reviewed in a preview before any production change.

## 3. Current Cloudflare Pages deployment

### Verified facts

- Cloudflare Pages project: `fanaticosos-web`.
- Connected repository: `fanaticosos/fanaticosos-web`.
- Production branch: `main`.
- Automatic Git deployments are enabled.
- Current domains:
  - `fanaticosos.com`
  - `www.fanaticosos.com`
  - `fanaticosos-web.pages.dev`
- The current project publishes the repository directly; its build command, output directory, and root directory are blank.
- Build comments are enabled, build cache is disabled, build watch paths include all files, and build system version 3 is selected.
- No deploy hooks, environment variables, secrets, or resource bindings were visible in the reviewed configuration.
- Preview deployments are public.

### Reasonable conclusion

The current Git-triggered production flow cannot wait for a private server to generate translations and audio, and generated MP3 files must not be stored in Git. Therefore, the final publishing pipeline must upload a completed static build rather than depend on Cloudflare to build directly from `main`.

### Approved architecture decision

- During the Astro migration, retain the current Cloudflare Git integration so branch previews can be reviewed.
- After translation and audio processing are proven, disable automatic production deployments.
- Have the processing server upload the completed Astro `dist/` directory to the existing Cloudflare Pages project using a restricted deployment credential.
- This transition requires separate owner authorization and will not occur during Phase 0.

## 4. Processing server: papabear

### Verified facts

- Hostname: `papabear`.
- Platform: Microsoft Hyper-V virtual machine.
- Operating system: Ubuntu Server 24.04.4 LTS.
- Architecture: x86-64.
- CPU: 12 virtual CPUs on an Intel Xeon Gold 6154 at 3.00 GHz.
- Available CPU features include AVX, AVX2, AVX512F, and FMA.
- Memory: approximately 31 GiB RAM and 8 GiB swap.
- GPU: no NVIDIA GPU or runtime detected.
- Storage:
  - 500 GB virtual disk.
  - 100 GB root logical volume, with approximately 83 GB available during discovery.
  - Approximately 397 GB remains unallocated in the LVM volume group.
- Network:
  - LAN: `192.168.1.11/24`.
  - NetBird: `100.121.48.92/16`.
  - NetBird FQDN: `papabear.netbird.selfhosted`.
- Installed baseline tools include Git, curl, and Python 3.
- Docker, Podman, Node.js, npm, FFmpeg, and ffprobe were not installed during discovery.

### Verified SSH state

- Dedicated Mac SSH identity: `~/.ssh/id_fanaticosos_blog`.
- Key-only access for the `sysadmin` account was verified over NetBird.
- Password-only authentication was verified as rejected.
- Effective SSH settings include:
  - `PermitRootLogin no`
  - `PubkeyAuthentication yes`
  - `PasswordAuthentication no`
  - `KbdInteractiveAuthentication no`
  - `MaxAuthTries 3`
- The SSH service is active.
- Reliable Hyper-V console access is available for recovery.

### Verified network and package state

- NetBird is enabled, active, and connected to management and signal services.
- DNS resolution succeeded for GitHub, Docker, Hugging Face, PyPI, and npm.
- Outbound HTTPS connectivity succeeded for those required sources. The Docker Registry returned HTTP 401, which confirms reachability without registry authentication.
- System time is synchronized through `systemd-timesyncd` in UTC.
- Ubuntu Noble base, updates, backports, and security repositories refreshed successfully.
- The NetBird package repository is configured and reachable.
- No package upgrades were pending at the end of discovery.

### Safety constraint

UFW remains inactive. Any future firewall policy must be reviewed before activation and must preserve NetBird operation, including its interface, WireGuard traffic, outbound management/signal/relay connectivity, and SSH access over NetBird. Firewall changes are outside the current authorized step.

## 5. Proposed content and publishing flow

### Approved functional requirements

- The owner writes one Spanish article.
- The system produces the English translation automatically.
- A sports glossary protects football terminology, club names, player names, competitions, and other proper nouns without requiring routine manual work.
- The system produces Spanish and English audio automatically.
- English and Spanish pages use distinct, crawlable URLs and complete localized metadata.
- Generated audio, downloaded models, temporary files, credentials, and secrets do not enter Git history.
- Translation or TTS failure must not damage or replace the currently published website.

### Recommended owner workflow

Provide a private browser-based editor on `papabear`, reachable only through NetBird. The editor should offer a Spanish article form, image upload, preview, and one Publish action. Articles remain portable Markdown files underneath the editor.

### Recommended automated flow

1. Save the authoritative Spanish article and media.
2. Validate required metadata and image attribution.
3. Produce or refresh the English translation.
4. Produce Spanish and English audio.
5. Build the complete static Astro site.
6. Run link, page, metadata, language-pair, and audio validation.
7. Preserve the current production deployment if any required stage fails.
8. Commit version-controlled source content to GitHub through an approved workflow.
9. Upload the validated static output to Cloudflare Pages only after deployment authorization rules are satisfied.

## 6. Technology recommendations pending validation

### Recommendations

- Static site generator: Astro with static output.
- Source article format: Markdown with validated front matter.
- Processing location: `papabear`.
- Translation: local open-source model, selected by a Spanish sports-journalism quality benchmark.
- Text to speech: Kokoro is the first CPU-compatible candidate to benchmark for Spanish and English; it is not yet an approved final engine.
- Audio encoding and inspection: FFmpeg and ffprobe.
- Process scheduling: systemd services and timers rather than a publicly exposed webhook or self-hosted GitHub runner.
- Production hosting: the existing Cloudflare Pages project.
- Initial audio delivery: Cloudflare Pages static assets; evaluate R2 only if measured limits or operating cost justify it.

## 7. Unknowns requiring later validation

- Which local translation model provides acceptable NFL and Chicago Bears journalism quality and processing time on this CPU-only server.
- Which Spanish and English TTS voices meet the owner's quality expectations.
- Actual model memory, storage, and article-processing times on `papabear`.
- Final audio format, bitrate, loudness target, and maximum file-size policy.
- Final article URL convention and category taxonomy.
- Final visual editor implementation and its authentication/session design.
- Image resizing, format, copyright-credit, and retention rules.
- Whether LAN SSH should remain reachable after a future firewall policy is introduced.
- Cloudflare account limits applicable at launch and the measured threshold for considering R2.
- Exact deployment approval mechanism: manual owner approval for every release or an owner-controlled Publish action that grants deployment authorization.

## 8. Phase 0 completion assessment

### Verified conclusion

The repository, Cloudflare project, business GitHub identity, processing host, private administrative path, outbound dependencies, package repositories, and time synchronization have been identified and validated sufficiently to design the implementation phases.

### Remaining Phase 0 documentation work

- Owner review and correction of this discovery record.
- Create the implementation plan with small, reversible phases, verification gates, rollback conditions, and explicit production authorization points.
- Commit the approved documentation in a focused local commit only after owner authorization.
