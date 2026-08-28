#!/usr/bin/env bash
set -euo pipefail
[[ "$(hostname)" == "papabear" ]] || { echo "STOP: Wrong server." >&2; exit 1; }
[[ "$(id -u)" == "0" ]] || { echo "STOP: Root-controlled deployment required." >&2; exit 1; }
repository="$1"; data_root="$2"; job_id="$3"
"$repository/scripts/deployment/deploy_cloudflare_production.sh" "$repository" "$data_root" "$job_id"
echo "PASS: Music-only release deployed and selected."
