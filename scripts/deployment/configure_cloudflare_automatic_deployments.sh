#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }

[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Cloudflare configuration must run through the restricted root helper."

readonly credential_file="/etc/fanaticosos-blog/cloudflare-pages.env"
readonly account_id="500cc7e82e34b5837b06a22ffee9f162"
readonly project_name="fanaticosos-web"
readonly production_branch="main"

[[ -f "$credential_file" && ! -L "$credential_file" ]] || stop "Cloudflare credential is missing."
[[ "$(stat -c '%U:%G:%a' "$credential_file")" == "root:root:600" ]] || stop "Cloudflare credential permissions are incorrect."

set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
[[ "$CLOUDFLARE_ACCOUNT_ID" == "$account_id" ]] || stop "Cloudflare account ID mismatch."
[[ "$CLOUDFLARE_PAGES_PROJECT" == "$project_name" ]] || stop "Cloudflare project mismatch."

readonly api="https://api.cloudflare.com/client/v4/accounts/$account_id/pages/projects/$project_name"
readonly response="$(curl --fail --silent --show-error --max-time 30 \
  --request PATCH \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"source":{"config":{"production_branch":"main","production_deployments_enabled":true}}}' \
  "$api")"
unset CLOUDFLARE_API_TOKEN

python3 - "$response" "$production_branch" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
branch = sys.argv[2]
if payload.get("success") is not True:
    raise SystemExit("Cloudflare rejected the automatic deployment configuration")
project = payload.get("result") or {}
config = ((project.get("source") or {}).get("config") or {})
if config.get("production_branch") != branch:
    raise SystemExit("Cloudflare production branch is not main")
if config.get("production_deployments_enabled") is not True:
    raise SystemExit("Cloudflare automatic production deployments remain disabled")
print("PASS: Cloudflare automatic production deployments are enabled for main.")
PY
