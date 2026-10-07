#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }

[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Cloudflare status must run through the restricted root helper."
[[ $# == 1 && "$1" =~ ^[0-9a-f]{7,40}$ ]] || stop "Expected a Git commit."

readonly expected="$1"
readonly credential_file="/etc/fanaticosos-blog/cloudflare-pages.env"
readonly account_id="500cc7e82e34b5837b06a22ffee9f162"
readonly project_name="fanaticosos-web"
[[ -f "$credential_file" && ! -L "$credential_file" ]] || stop "Cloudflare credential is missing."
[[ "$(stat -c '%U:%G:%a' "$credential_file")" == "root:root:600" ]] || stop "Cloudflare credential permissions are incorrect."

set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
[[ "$CLOUDFLARE_ACCOUNT_ID" == "$account_id" ]] || stop "Cloudflare account ID mismatch."
[[ "$CLOUDFLARE_PAGES_PROJECT" == "$project_name" ]] || stop "Cloudflare project mismatch."

readonly api="https://api.cloudflare.com/client/v4/accounts/$account_id/pages/projects/$project_name"
readonly project_json="$(curl --fail --silent --show-error --max-time 30 --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api")"
readonly deployments_json="$(curl --fail --silent --show-error --max-time 30 --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/deployments?env=production&per_page=20")"
unset CLOUDFLARE_API_TOKEN

python3 - "$project_json" "$deployments_json" "$expected" <<'PY'
import json, sys

project = json.loads(sys.argv[1]).get("result") or {}
deployments = json.loads(sys.argv[2]).get("result") or []
expected = sys.argv[3]
config = ((project.get("source") or {}).get("config") or {})
match = next(
    (
        deployment for deployment in deployments
        if (((deployment.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") or "").startswith(expected)
    ),
    None,
)
print(f"production_branch={config.get('production_branch', '')}")
print(f"production_deployments_enabled={str(config.get('production_deployments_enabled')).lower()}")
if match is None:
    print("expected_deployment=missing")
    raise SystemExit(2)
trigger = match.get("deployment_trigger") or {}
metadata = trigger.get("metadata") or {}
stage = match.get("latest_stage") or {}
print(f"expected_deployment={match.get('id', '')}")
print(f"trigger={trigger.get('type', '')}")
print(f"commit={metadata.get('commit_hash', '')}")
print(f"stage={stage.get('name', '')}")
print(f"status={stage.get('status', '')}")
print(f"url={match.get('url', '')}")
if config.get("production_branch") != "main" or config.get("production_deployments_enabled") is not True:
    raise SystemExit(3)
if trigger.get("type") != "github:push":
    raise SystemExit(4)
if stage.get("status") != "success":
    raise SystemExit(5)
PY
