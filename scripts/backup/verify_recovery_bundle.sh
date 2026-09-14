#!/usr/bin/env bash
set -euo pipefail

[[ $# == 1 ]] || { echo "usage: verify_recovery_bundle.sh ARCHIVE" >&2; exit 2; }
readonly archive="$1"
[[ -f "$archive" && ! -L "$archive" ]] || { echo "recovery archive is missing or unsafe" >&2; exit 1; }
drill="$(mktemp -d)"
trap 'rm -rf -- "$drill"' EXIT

tar -tzf "$archive" | grep -E '(^/|(^|/)\.\.(/|$))' && { echo "archive contains an unsafe path" >&2; exit 1; }
tar -xzf "$archive" -C "$drill"
(
  cd "$drill"
  sha256sum -c SHA256SUMS
)

sqlite_result="$(sqlite3 "$drill/payload/publisher.sqlite" 'PRAGMA integrity_check;')"
[[ "$sqlite_result" == "ok" ]] || { echo "publisher SQLite restore drill failed: $sqlite_result" >&2; exit 1; }
sqlite3 "$drill/d1-restored.sqlite" < "$drill/payload/fanaticosos-participa.sql"
d1_result="$(sqlite3 "$drill/d1-restored.sqlite" 'PRAGMA integrity_check;')"
[[ "$d1_result" == "ok" ]] || { echo "D1 SQL restore drill failed: $d1_result" >&2; exit 1; }

audio_count=0
while IFS= read -r -d '' audio; do
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$audio" >/dev/null
  audio_count=$((audio_count + 1))
done < <(find "$drill/payload/audio" "$drill/payload/elevenlabs-cache" -type f -name '*.mp3' -print0)

python3 - "$drill/MANIFEST.json" <<'PY'
import json, sys
value=json.load(open(sys.argv[1], encoding="utf-8"))
assert value["schemaVersion"] == 1
assert value["d1"]["id"] == "6bbd7721-7b4e-4280-ba01-3ef35ca82d53"
print(json.dumps(value, indent=2))
PY
echo "PASS: Recovery drill restored SQLite and D1 and decoded $audio_count MP3 files."
