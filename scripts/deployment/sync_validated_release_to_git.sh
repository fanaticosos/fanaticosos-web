#!/usr/bin/env bash
set -euo pipefail

stop() { echo "STOP: $*" >&2; exit 1; }

[[ "$(hostname)" == "papabear" ]] || stop "Wrong server. Expected papabear."
[[ "$(id -u)" == "0" ]] || stop "Production source synchronization must run through the restricted root deployment."
[[ $# == 3 ]] || stop "Expected REPOSITORY RELEASE_ROOT RELEASE_JOB_ID."

readonly repository="$1"
readonly release_root="$2"
readonly job_id="$3"
readonly service_account="fanaticosos-blog"
readonly production_branch="main"
readonly remote="origin"
readonly required_paths=(
  "src/content/articles"
  "src/data/game-center.json"
  "src/data/site-settings.json"
  "public/audio"
  "public/images"
)
readonly optional_paths=("public/uploads")

[[ "$job_id" =~ ^release-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$ ]] || stop "Invalid release job ID."
[[ -d "$repository/.git" && ! -L "$repository" ]] || stop "Repository is missing."
[[ -d "$release_root" && ! -L "$release_root" ]] || stop "Validated release source is missing."
[[ -z "$(runuser -u "$service_account" -- git -C "$repository" status --porcelain)" ]] || stop "Repository is not clean."

for path in "${required_paths[@]}"; do
  [[ -e "$release_root/$path" && ! -L "$release_root/$path" ]] || stop "Validated release path is missing: $path"
done

runuser -u "$service_account" -- git -C "$repository" fetch "$remote" "$production_branch"
runuser -u "$service_account" -- git -C "$repository" merge --ff-only FETCH_HEAD

sync_path() {
  local path="$1"
  local source="$release_root/$path"
  local target="$repository/$path"
  if [[ -d "$source" ]]; then
    install -d -o "$service_account" -g "$service_account" "$(dirname "$target")" "$target"
    runuser -u "$service_account" -- rsync -a --delete "$source/" "$target/"
  else
    install -d -o "$service_account" -g "$service_account" "$(dirname "$target")"
    runuser -u "$service_account" -- cp -p "$source" "$target"
  fi
}

for path in "${required_paths[@]}"; do sync_path "$path"; done
stage_paths=("${required_paths[@]}")
for path in "${optional_paths[@]}"; do
  if [[ -e "$release_root/$path" && ! -L "$release_root/$path" ]]; then
    sync_path "$path"
    stage_paths+=("$path")
  fi
done

runuser -u "$service_account" -- git -C "$repository" add -- "${stage_paths[@]}"
if runuser -u "$service_account" -- git -C "$repository" diff --cached --quiet; then
  echo "PASS: Validated production source already matches Git main."
  exit 0
fi

runuser -u "$service_account" -- git -C "$repository" commit \
  -m "[CI Skip] Sync validated production $job_id"
runuser -u "$service_account" -- git -C "$repository" push "$remote" "HEAD:$production_branch"

readonly local_commit="$(runuser -u "$service_account" -- git -C "$repository" rev-parse HEAD)"
readonly remote_commit="$(runuser -u "$service_account" -- git -C "$repository" ls-remote "$remote" "refs/heads/$production_branch" | cut -f1)"
[[ "$local_commit" == "$remote_commit" ]] || stop "Git main did not retain the validated production commit."
echo "PASS: Validated production source synchronized to Git main at ${local_commit:0:7}."
