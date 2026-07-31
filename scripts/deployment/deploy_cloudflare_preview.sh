#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }

[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Preview deployment must run through the restricted root helper."
[[ $# == 3 ]] || stop "Expected REPOSITORY DATA_ROOT RELEASE_JOB_ID."

readonly repository="$1"
readonly data_root="$2"
readonly job_id="$3"
readonly service_account="fanaticosos-blog"
readonly credential_file="/etc/fanaticosos-blog/cloudflare-pages.env"
readonly project_name="fanaticosos-web"
readonly production_branch="main"

[[ "$job_id" =~ ^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$ ]] || stop "Invalid release job ID."
readonly preview_branch="papabear-preview-${job_id: -8}"
[[ "$preview_branch" != "$production_branch" ]] || stop "Preview branch cannot be the production branch."

readonly job_root="$data_root/publisher/releases/$job_id"
readonly release_root="$job_root/release"
readonly dist_root="$release_root/dist"
readonly manifest="$release_root/release-manifest.json"
readonly receipt="$job_root/cloudflare-preview.json"
readonly log_file="$job_root/cloudflare-preview.log"
readonly wrangler="$repository/node_modules/.bin/wrangler"

[[ -f "$credential_file" && ! -L "$credential_file" ]] || stop "Cloudflare credential is missing."
[[ "$(stat -c '%U:%G:%a' "$credential_file")" == "root:root:600" ]] || stop "Cloudflare credential permissions are incorrect."
[[ -f "$manifest" && -d "$dist_root" ]] || stop "Validated release bundle is missing."
[[ ! -e "$receipt" && ! -e "$log_file" ]] || stop "This release already has a Cloudflare preview record."
[[ -x "$wrangler" ]] || stop "Pinned Wrangler runtime is missing."

mapfile -t manifest_values < <(python3 - "$manifest" "$dist_root" <<'PY'
import json
import os
import sys

manifest_path, dist_root = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("schemaVersion") != 1 or manifest.get("deployment") != "disabled":
    raise SystemExit("release manifest is not deployment-disabled schema version 1")
commit = manifest.get("commit", "")
if len(commit) != 40 or any(char not in "0123456789abcdef" for char in commit):
    raise SystemExit("release manifest commit is invalid")
routes = manifest.get("routes", {})
assets = manifest.get("assets", {})
required = [routes.get("es"), routes.get("en")]
for key in ("esAudio", "enAudio"):
    path = assets.get(key, {}).get("path", "")
    if not path.startswith("public/audio/") or not path.endswith(".mp3"):
        raise SystemExit(f"release manifest {key} is invalid")
    required.append("/" + path.removeprefix("public/"))
for path in required:
    if not isinstance(path, str) or not path.startswith("/"):
        raise SystemExit("release path is invalid")
    local = os.path.join(dist_root, path.lstrip("/"))
    if path.endswith("/"):
        local = os.path.join(local, "index.html")
    if not os.path.isfile(local) or os.path.getsize(local) == 0:
        raise SystemExit(f"release output is missing: {path}")
print(commit)
for path in required:
    print(path)
PY
)
[[ ${#manifest_values[@]} == 5 ]] || stop "Release manifest validation did not return five values."
readonly commit="${manifest_values[0]}"

set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
[[ "$CLOUDFLARE_ACCOUNT_ID" == "500cc7e82e34b5837b06a22ffee9f162" ]] || stop "Cloudflare account ID mismatch."
[[ "$CLOUDFLARE_PAGES_PROJECT" == "$project_name" ]] || stop "Cloudflare project mismatch."

umask 0077
readonly temporary_log="$job_root/.cloudflare-preview.log.$$"
if ! timeout 5m runuser -u "$service_account" -- env \
  HOME="$data_root" \
  PATH="/opt/nodejs/current/bin:/usr/bin:/bin" \
  CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  "$wrangler" pages deploy "$dist_root" \
    --project-name "$project_name" \
    --branch "$preview_branch" \
    --commit-hash "$commit" \
    --commit-message "Validated Papabear preview $job_id" \
    --commit-dirty=false >"$temporary_log" 2>&1; then
  unset CLOUDFLARE_API_TOKEN
  mv "$temporary_log" "$log_file"
  chown "$service_account:$service_account" "$log_file"
  chmod 0600 "$log_file"
  echo "STOP: Wrangler preview upload failed; private diagnostics were preserved." >&2
  exit 1
fi
unset CLOUDFLARE_API_TOKEN

readonly preview_url="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.pages\.dev' "$temporary_log" | tail -n 1)"
[[ "$preview_url" =~ ^https://[a-zA-Z0-9.-]+\.pages\.dev$ ]] || stop "Wrangler did not return a valid preview URL."
[[ "$preview_url" != "https://fanaticosos-web.pages.dev" ]] || stop "Wrangler returned the production Pages URL."

for path in "${manifest_values[@]:1}"; do
  passed=false
  for attempt in 1 2 3 4 5; do
    if curl --fail --silent --show-error --max-time 20 --output /dev/null "$preview_url$path"; then
      passed=true
      break
    fi
    sleep 2
  done
  [[ "$passed" == true ]] || stop "Preview validation failed for $path."
done

mv "$temporary_log" "$log_file"
chown "$service_account:$service_account" "$log_file"
chmod 0600 "$log_file"
python3 - "$receipt" "$job_id" "$preview_branch" "$preview_url" "$commit" <<'PY'
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

path, job_id, branch, url, commit = sys.argv[1:]
receipt = {
    "schemaVersion": 1,
    "environment": "preview",
    "jobId": job_id,
    "branch": branch,
    "url": url,
    "commit": commit,
    "validatedAt": datetime.now(timezone.utc).isoformat(),
    "productionChanged": False,
}
directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix=".cloudflare-preview.", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(receipt, handle, indent=2)
        handle.write("\n")
    os.chmod(temporary, 0o600)
    os.chown(temporary, os.stat(directory).st_uid, os.stat(directory).st_gid)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

echo "PASS: Validated Cloudflare preview deployed."
echo "Preview URL: $preview_url"
echo "Preview branch: $preview_branch"
echo "PASS: Production branch and domains were not targeted."
