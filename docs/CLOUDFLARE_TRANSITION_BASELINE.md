# Cloudflare Pages transition baseline

Recorded: 2026-07-31  
Account: `Antonio@fanaticosos.com's Account`  
Account ID: `500cc7e82e34b5837b06a22ffee9f162`  
Project: `fanaticosos-web`

This document contains no API token, secret, or credential.

## Verified current state

- Project type: Cloudflare Pages with GitHub integration.
- Repository: `fanaticosos/fanaticosos-web`.
- Production branch: `main`.
- Automatic production deployments: disabled with owner authorization on 2026-07-31.
- Automatic preview deployments: disabled with owner authorization on 2026-07-31.
- Current production commit: `13bd722929a16e794cfe73e2f542b29b2bb07ef8`.
- Current production deployment: `https://1e519caa.fanaticosos-web.pages.dev`.
- Production domains: `fanaticosos.com`, `www.fanaticosos.com`, and `fanaticosos-web.pages.dev`.
- Both custom domains are active with SSL enabled.
- Build command: `npm run build`.
- Build output directory: `dist`.
- Root directory: repository root.
- Build system: version 3.
- Build cache: disabled.
- Build comments: enabled.
- Production variable: `NODE_VERSION=24.18.0`.
- No deploy hooks, Pages bindings, compatibility flags, or other project variables were shown.
- Preview deployments are public.

## Verified rollback target

Until an explicitly authorized production deployment succeeds, the rollback reference is:

- commit `13bd722929a16e794cfe73e2f542b29b2bb07ef8`;
- deployment `1e519caa-932c-4e87-8817-f852650c6299`;
- deployment URL `https://1e519caa.fanaticosos-web.pages.dev`.

Cloudflare's retained deployment remains the authoritative production rollback. No local operation should delete or replace it.

## Verified Papabear preview

The first stable release preview was uploaded after automatic preview builds were disabled:

- private release job: `release-11d4e27593be48e1920a5e6884672c52-r1-73b220f9`;
- release commit: `6212b6e91a813762fc14f9c68de44f23ec7f19d4`;
- Cloudflare preview branch: `papabear-preview-73b220f9`;
- immutable deployment: `4aa0209e-4fd6-474d-bf06-2d2719bf83ce`;
- immutable URL: `https://4aa0209e.fanaticosos-web.pages.dev`;
- Spanish and English article routes returned HTTP 200;
- both deployed MP3 files returned HTTP 200 and matched the private release checksums;
- the private article remained absent from both production custom domains.

A prior manual preview was overwritten by an automatic Git preview of the same source
commit. This proved that automatic preview builds must remain disabled while Papabear is
the controlled preview uploader. A later feature-branch push was marked `Skipped` by
Cloudflare, verifying the new setting.

## Cloudflare constraint

Cloudflare documents that a Git-integrated Pages project cannot be converted into a Direct Upload project. It can, however, receive manual Wrangler deployments. Cloudflare also documents disabling automatic production and preview branch deployments when Wrangler becomes the controlled deployment path.

Sources:

- <https://developers.cloudflare.com/pages/get-started/git-integration/>
- <https://developers.cloudflare.com/pages/get-started/direct-upload/>
- <https://developers.cloudflare.com/pages/configuration/api/>

## Recommended transition order

1. Keep the current production deployment and Git integration unchanged.
2. Create a custom API token with only account-level Cloudflare Pages Edit access, restricted to the Fanaticosos account.
3. Store the token outside Git on `papabear` with root-only permissions.
4. Upload the already validated private release to a non-production Wrangler branch.
5. Validate both languages, MP3s, metadata, feeds, sitemap, and asset checksums on that preview URL.
6. After preview acceptance, request owner authorization to disable automatic production builds. Completed and verified on 2026-07-31.
7. Require a separate owner authorization before the first Wrangler production deployment.

This order keeps `fanaticosos.com` unchanged throughout preview validation and preserves the recorded rollback deployment. Git pushes can no longer trigger production or preview builds; validated Wrangler uploads from Papabear are now the only enabled deployment path.

## Remaining production unknowns

- First controlled production upload duration.
- Final production health-check and rollback timing.

These unknowns must be measured only after separate production authorization.
