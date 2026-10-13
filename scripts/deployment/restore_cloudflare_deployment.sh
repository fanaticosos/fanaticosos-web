#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }
[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Cloudflare recovery must run through the restricted root helper."
[[ $# == 1 && "$1" =~ ^[0-9a-f]{8}$ ]] || stop "Expected an eight-character deployment prefix."

readonly prefix="$1"
readonly credential_file="/etc/fanaticosos-blog/cloudflare-pages.env"
readonly account_id="500cc7e82e34b5837b06a22ffee9f162"
readonly project_name="fanaticosos-web"
[[ -f "$credential_file" && ! -L "$credential_file" ]] || stop "Cloudflare credential is missing."
[[ "$(stat -c '%U:%G:%a' "$credential_file")" == "root:root:600" ]] || stop "Cloudflare credential permissions are incorrect."
set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
readonly api="https://api.cloudflare.com/client/v4/accounts/$account_id/pages/projects/$project_name"
readonly deployments="$(curl --fail --silent --show-error --max-time 30 \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/deployments?env=production&per_page=25")"
readonly deployment_id="$(python3 - "$deployments" "$prefix" <<'PY'
import json, sys
items = json.loads(sys.argv[1]).get("result") or []
matches = [item.get("id", "") for item in items if item.get("id", "").startswith(sys.argv[2])]
if len(matches) != 1:
    raise SystemExit("deployment prefix is missing or ambiguous")
print(matches[0])
PY
)"
readonly response="$(curl --fail --silent --show-error --max-time 30 --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" --data '{}' \
  "$api/deployments/$deployment_id/rollback")"
unset CLOUDFLARE_API_TOKEN
python3 - "$response" "$deployment_id" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get("success") is not True or not (payload.get("result") or {}).get("id"):
    raise SystemExit("Cloudflare rejected the production restore")
print(f"PASS: Restored Cloudflare deployment {sys.argv[2]}.")
PY
