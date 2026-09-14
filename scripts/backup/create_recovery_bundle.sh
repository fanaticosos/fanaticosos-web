#!/usr/bin/env bash
set -euo pipefail

[[ $# == 6 ]] || { echo "usage: create_recovery_bundle.sh REPOSITORY DATA_ROOT CREDENTIAL_FILE BACKUP_ID COMMIT RECIPIENT" >&2; exit 2; }
readonly repository="$1" data_root="$2" credential_file="$3" backup_id="$4" commit="$5" recipient="$6"
readonly export_root="/var/tmp/fanaticosos-recovery"
readonly final_archive="$export_root/recovery-${backup_id#db-}.tar.gz"
staging="$(mktemp -d "$data_root/work/recovery-bundle.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT

[[ "$backup_id" =~ ^db-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "invalid backup ID" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit" >&2; exit 1; }
[[ "$recipient" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "invalid archive recipient" >&2; exit 1; }
[[ -f "$credential_file" && ! -L "$credential_file" ]] || { echo "Cloudflare credential is missing" >&2; exit 1; }
[[ ! -e "$final_archive" ]] || { echo "refusing to overwrite $final_archive" >&2; exit 1; }

chown fanaticosos-blog:fanaticosos-blog "$staging"
chmod 0700 "$staging"
install -d -o fanaticosos-blog -g fanaticosos-blog -m 0700 "$staging/payload"
install -o fanaticosos-blog -g fanaticosos-blog -m 0600 \
  "$data_root/publisher/backups/database/$backup_id.sqlite" "$staging/payload/publisher.sqlite"
cp -a "$data_root/publisher/artifacts/audio" "$staging/payload/audio"
cp -a "$data_root/publisher/cache/tts/elevenlabs" "$staging/payload/elevenlabs-cache"
find "$staging/payload" -type l -print -quit | grep -q . && { echo "backup inputs may not contain symlinks" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$credential_file"
set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
python3 - "$staging/payload/fanaticosos-participa.sql" <<'PY'
import json, os, sys, time, urllib.request

database_id = "6bbd7721-7b4e-4280-ba01-3ef35ca82d53"
endpoint = f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/d1/database/{database_id}/export"
headers = {"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}", "Content-Type": "application/json"}
bookmark = None
for _ in range(60):
    body = {"output_format": "polling"}
    if bookmark:
        body["current_bookmark"] = bookmark
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        value = json.load(response)
    result = value.get("result") or {}
    if not value.get("success") or result.get("error"):
        raise RuntimeError("Cloudflare D1 export failed without exposing credentials")
    if result.get("status") == "complete":
        signed_url = (result.get("result") or {}).get("signed_url")
        if not signed_url:
            raise RuntimeError("Cloudflare D1 export completed without a download URL")
        with urllib.request.urlopen(signed_url, timeout=60) as response, open(sys.argv[1], "wb") as output:
            output.write(response.read())
        break
    bookmark = result.get("at_bookmark")
    if not bookmark:
        raise RuntimeError("Cloudflare D1 export did not return a polling bookmark")
    time.sleep(2)
else:
    raise RuntimeError("Cloudflare D1 export timed out")
if os.path.getsize(sys.argv[1]) == 0:
    raise RuntimeError("Cloudflare D1 export was empty")
PY
unset CLOUDFLARE_API_TOKEN

(
  cd "$staging"
  find payload -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  python3 - "$backup_id" "$commit" > MANIFEST.json <<'PY'
import json, sys
from datetime import datetime, timezone
print(json.dumps({
  "schemaVersion": 1,
  "backupId": sys.argv[1],
  "sourceCommit": sys.argv[2],
  "createdAt": datetime.now(timezone.utc).isoformat(),
  "d1": {"name": "fanaticosos-participa", "id": "6bbd7721-7b4e-4280-ba01-3ef35ca82d53"},
  "contents": ["SQLite", "accepted bilingual audio", "ElevenLabs block cache", "Cloudflare D1 SQL export"],
}, indent=2))
PY
)

install -d -o "$recipient" -g "$recipient" -m 0700 "$export_root"
tar -C "$staging" -czf "$final_archive.tmp" MANIFEST.json SHA256SUMS payload
chmod 0600 "$final_archive.tmp"
chown "$recipient:$recipient" "$final_archive.tmp"
mv "$final_archive.tmp" "$final_archive"
sha256sum "$final_archive"
echo "PASS: Recovery bundle created at $final_archive"
