#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }

[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Production deployment must run through the restricted root helper."
[[ $# == 3 ]] || stop "Expected REPOSITORY DATA_ROOT RELEASE_JOB_ID."

readonly repository="$1"
readonly data_root="$2"
readonly job_id="$3"
readonly service_account="fanaticosos-blog"
readonly credential_file="/etc/fanaticosos-blog/cloudflare-pages.env"
readonly project_name="fanaticosos-web"
readonly production_branch="main"
readonly job_root="$data_root/publisher/releases/$job_id"
readonly release_root="$job_root/release"
readonly dist_root="$release_root/dist"
readonly manifest="$release_root/release-manifest.json"
readonly receipt="$job_root/cloudflare-production.json"
readonly log_file="$job_root/cloudflare-production.log"
readonly wrangler="$repository/node_modules/.bin/wrangler"

[[ "$job_id" =~ ^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$ ]] || stop "Invalid release job ID."
[[ -f "$credential_file" && ! -L "$credential_file" ]] || stop "Cloudflare credential is missing."
[[ "$(stat -c '%U:%G:%a' "$credential_file")" == "root:root:600" ]] || stop "Cloudflare credential permissions are incorrect."
[[ -f "$manifest" && -d "$dist_root" ]] || stop "Validated release bundle is missing."
[[ ! -e "$receipt" && ! -e "$log_file" ]] || stop "This release already has a Cloudflare production record."
[[ -x "$wrangler" ]] || stop "Pinned Wrangler runtime is missing."

mapfile -t manifest_values < <(python3 - "$manifest" "$dist_root" <<'PY'
import hashlib, json, os, sys
manifest_path, dist_root = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("schemaVersion") != 1 or manifest.get("deployment") != "disabled":
    raise SystemExit("release manifest is not deployment-disabled schema version 1")
commit = manifest.get("commit", "")
if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
    raise SystemExit("release manifest commit is invalid")
routes = manifest.get("routes", {})
assets = manifest.get("assets", {})
items = [(routes.get("es"), ""), (routes.get("en"), "")]
if manifest.get("releaseKind") == "music":
    checksum = manifest.get("homepageSha256", "")
    if len(checksum) != 64:
        raise SystemExit("music release homepage checksum is invalid")
    items.append(("/", checksum))
for key in ("esAudio", "enAudio"):
    asset = assets.get(key, {})
    path = asset.get("path", "")
    checksum = asset.get("sha256", "")
    if not path.startswith("public/audio/") or not path.endswith(".mp3") or len(checksum) != 64:
        raise SystemExit(f"release manifest {key} is invalid")
    items.append(("/" + path.removeprefix("public/"), checksum))
for path, checksum in items:
    if not isinstance(path, str) or not path.startswith("/"):
        raise SystemExit("release path is invalid")
    local = os.path.join(dist_root, path.lstrip("/"))
    if path.endswith("/"):
        local = os.path.join(local, "index.html")
    if os.path.commonpath((os.path.realpath(dist_root), os.path.realpath(local))) != os.path.realpath(dist_root):
        raise SystemExit(f"release output escapes dist root: {path}")
    if not os.path.isfile(local) or os.path.getsize(local) == 0:
        raise SystemExit(f"release output is missing: {path}")
    if checksum:
        with open(local, "rb") as handle:
            actual = hashlib.sha256(handle.read()).hexdigest()
        if actual != checksum:
            raise SystemExit(f"release checksum mismatch: {path}")
print(commit)
for path, checksum in items:
    print(f"{path}\t{checksum}")
PY
)
[[ ${#manifest_values[@]} -ge 5 ]] || stop "Release manifest validation returned too few values."
readonly commit="${manifest_values[0]}"

set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
[[ "$CLOUDFLARE_ACCOUNT_ID" == "500cc7e82e34b5837b06a22ffee9f162" ]] || stop "Cloudflare account ID mismatch."
[[ "$CLOUDFLARE_PAGES_PROJECT" == "$project_name" ]] || stop "Cloudflare project mismatch."

readonly api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$project_name"
readonly before_json="$(curl --fail --silent --show-error --max-time 30 --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/deployments?env=production&per_page=10")"
mapfile -t deployment_state < <(python3 - "$before_json" <<'PY'
import json, sys
results = json.loads(sys.argv[1]).get("result", [])
if len(results) < 2:
    raise SystemExit("fewer than two production deployments returned")
current = results[0]
current_commit = ((current.get("source") or {}).get("config") or {}).get("commit_hash", "")
previous = results[1]
print(current.get("id", ""))
print(current.get("url", ""))
print(current_commit)
print(previous.get("id", ""))
print(previous.get("url", ""))
PY
)
[[ ${#deployment_state[@]} == 5 ]] || stop "Could not resolve current and rollback production deployments."

umask 0077
shopt -s nullglob
temporary_logs=("$job_root"/.cloudflare-production.log.*)
shopt -u nullglob
deployment_url=""
rollback_id="${deployment_state[0]}"
rollback_url="${deployment_state[1]}"
if [[ ${#temporary_logs[@]} == 1 ]] && grep -Fq "${deployment_state[1]}" "${temporary_logs[0]}"; then
  temporary_log="${temporary_logs[0]}"
  deployment_url="${deployment_state[1]}"
  rollback_id="${deployment_state[3]}"
  rollback_url="${deployment_state[4]}"
  echo "Resuming validation of the already-uploaded production deployment."
elif [[ ${#temporary_logs[@]} == 0 ]]; then
  temporary_log="$job_root/.cloudflare-production.log.$$"
else
  stop "Production recovery state is ambiguous; refusing another upload."
fi
cd "$release_root"
if [[ -z "$deployment_url" ]]; then
  if ! timeout 5m runuser -u "$service_account" -- env \
    HOME="$data_root" PATH="/opt/nodejs/current/bin:/usr/bin:/bin" \
    CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
    "$wrangler" pages deploy "$dist_root" --project-name "$project_name" \
      --branch "$production_branch" --commit-hash "$commit" \
      --commit-message "Validated Papabear production $job_id" --commit-dirty=false >"$temporary_log" 2>&1; then
    unset CLOUDFLARE_API_TOKEN
    mv "$temporary_log" "$log_file"; chown "$service_account:$service_account" "$log_file"; chmod 0600 "$log_file"
    stop "Wrangler production upload failed; private diagnostics were preserved."
  fi
  deployment_url="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.pages\.dev' "$temporary_log" | tail -n 1)"
fi
unset CLOUDFLARE_API_TOKEN

[[ "$deployment_url" =~ ^https://[a-zA-Z0-9.-]+\.pages\.dev$ ]] || stop "Wrangler did not return a valid deployment URL."
readonly domains=("https://fanaticosos.com" "https://www.fanaticosos.com" "https://fanaticosos-web.pages.dev")
for domain in "${domains[@]}"; do
  for item in "${manifest_values[@]:1}"; do
    IFS=$'\t' read -r path checksum <<<"$item"
    passed=false
    for attempt in 1 2 3 4 5 6; do
      temporary_body="$job_root/.cloudflare-body.$$"
      if curl --fail --silent --show-error --max-time 30 --output "$temporary_body" "$domain$path"; then
        if [[ -z "$checksum" || "$(sha256sum "$temporary_body" | cut -d' ' -f1)" == "$checksum" ]]; then passed=true; fi
      fi
      rm -f "$temporary_body"
      [[ "$passed" == true ]] && break
      sleep 3
    done
    [[ "$passed" == true ]] || stop "Production validation failed for $domain$path."
  done
done

# The locally selected release is the source for later music-only builds. Keep it
# aligned with the production bundle that just passed validation, regardless of
# whether this deployment was initiated by an article or a music update.
runuser -u "$service_account" -- /opt/nodejs/current/bin/node \
  "$repository/scripts/publisher/select_release.mjs" \
  --releases-root "$data_root/publisher/releases" --job-id "$job_id"

mv "$temporary_log" "$log_file"; chown "$service_account:$service_account" "$log_file"; chmod 0600 "$log_file"
python3 - "$receipt" "$job_id" "$deployment_url" "$commit" "$rollback_id" "$rollback_url" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, job_id, url, commit, rollback_id, rollback_url = sys.argv[1:]
value = {"schemaVersion": 1, "environment": "production", "jobId": job_id,
 "branch": "main", "url": url, "commit": commit,
 "validatedAt": datetime.now(timezone.utc).isoformat(), "productionChanged": True,
 "rollbackDeploymentId": rollback_id, "rollbackUrl": rollback_url,
 "domains": ["https://fanaticosos.com", "https://www.fanaticosos.com", "https://fanaticosos-web.pages.dev"]}
directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix=".cloudflare-production.", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle: json.dump(value, handle, indent=2); handle.write("\n")
    os.chmod(temporary, 0o600); os.chown(temporary, os.stat(directory).st_uid, os.stat(directory).st_gid); os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
echo "PASS: Validated Cloudflare production deployment completed."
echo "Deployment URL: $deployment_url"
echo "Rollback deployment: $rollback_id"
