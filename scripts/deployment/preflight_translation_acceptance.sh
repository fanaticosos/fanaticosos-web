#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --expected-commit COMMIT --job-id JOB_ID"
}

expected_commit=""
job_id=""

while (( $# > 0 )); do
  case "$1" in
    --expected-commit)
      expected_commit="${2:-}"
      shift 2
      ;;
    --job-id)
      job_id="${2:-}"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "STOP: Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$expected_commit" || -z "$job_id" ]]; then
  usage
  exit 1
fi

if [[ "$(hostname)" != "papabear" ]]; then
  echo "STOP: Wrong server. Expected papabear."
  exit 1
fi

if [[ ! "$job_id" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "STOP: Job ID must be lowercase kebab case."
  exit 1
fi

service_account="fanaticosos-blog"
repository="/opt/fanaticosos-blog/repository"
source_unit="$repository/deploy/systemd/fanaticosos-translation@.service"
installed_unit="/etc/systemd/system/fanaticosos-translation@.service"
fixture="$repository/benchmarks/translation/full-article-request.json"
glossary="$repository/config/translation/glossary.json"
model="/opt/fanaticosos-blog/models/qwen3-8b-gguf/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf"
llama_cli="/opt/fanaticosos-blog/tools/llama.cpp-b10195/llama-b10195/llama-cli"
job_dir="/opt/fanaticosos-blog/jobs/$job_id"

echo "=== Identity and repository ==="
current_commit="$(
  sudo -u "$service_account" -H \
    git -C "$repository" rev-parse HEAD
)"
echo "Host: $(hostname)"
echo "Repository commit: ${current_commit:0:7}"

if [[ "$current_commit" != "$expected_commit" ]]; then
  echo "STOP: Expected commit $expected_commit; found $current_commit."
  exit 1
fi

if [[ -n "$(
  sudo -u "$service_account" -H \
    git -C "$repository" status --porcelain
)" ]]; then
  echo "STOP: Repository is not clean."
  exit 1
fi

echo "PASS: Repository identity is correct and clean."

echo
echo "=== Service-account file access ==="
for required_file in \
  "$source_unit" \
  "$fixture" \
  "$glossary" \
  "$model" \
  "$llama_cli"
do
  if ! sudo -u "$service_account" -H test -r "$required_file"; then
    echo "STOP: Service account cannot read $required_file"
    exit 1
  fi
done

if ! sudo -u "$service_account" -H test -x "$llama_cli"; then
  echo "STOP: Service account cannot execute llama.cpp."
  exit 1
fi

echo "PASS: Runtime, model, configuration, and fixture are accessible."

echo
echo "=== JSON and contract verification ==="
sudo -u "$service_account" -H \
  env PYTHONDONTWRITEBYTECODE=1 \
  python3 -m json.tool "$glossary" >/dev/null

sudo -u "$service_account" -H \
  env PYTHONDONTWRITEBYTECODE=1 \
  python3 -m json.tool "$fixture" >/dev/null

sudo -u "$service_account" -H \
  env PYTHONDONTWRITEBYTECODE=1 \
  python3 "$repository/scripts/translation/test_article_contract.py"

glossary_version="$(
  sudo -u "$service_account" -H \
    env PYTHONDONTWRITEBYTECODE=1 \
    python3 -c \
      'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' \
      "$glossary"
)"

if [[ "$glossary_version" != "5" ]]; then
  echo "STOP: Expected glossary version 5; found $glossary_version."
  exit 1
fi

echo "PASS: JSON, article contract, and glossary version are valid."

echo
echo "=== Versioned systemd verification ==="
verify_output="$(sudo systemd-analyze verify "$source_unit" 2>&1)"
verify_status=$?

if [[ $verify_status -ne 0 || -n "$verify_output" ]]; then
  printf '%s\n' "$verify_output"
  echo "STOP: Versioned systemd verification was not clean."
  exit 1
fi

if ! sudo grep -Fq -- '--configuration-version 9' "$source_unit"; then
  echo "STOP: Versioned unit is not configuration version 9."
  exit 1
fi

if ! sudo grep -Fq -- '--max-batch-characters 12000' "$source_unit"; then
  echo "STOP: Versioned unit lacks the approved batch limit."
  exit 1
fi

echo "PASS: Versioned systemd template is valid."

echo
echo "=== Installed-template state ==="
if ! sudo test -f "$installed_unit"; then
  echo "STOP: Installed systemd template is missing."
  exit 1
fi

if sudo cmp -s "$source_unit" "$installed_unit"; then
  echo "Installed template already matches configuration version 9."
else
  echo "CHANGE REQUIRED: Installed template must be replaced with version 9."
fi

echo
echo "=== Process and job isolation ==="
processes="$(
  pgrep -af 'translate_article_qwen.py|llama-cli|Qwen3-8B-Q4_K_M' || true
)"

if [[ -n "$processes" ]]; then
  printf '%s\n' "$processes"
  echo "STOP: A translation process already exists."
  exit 1
fi

if sudo test -e "$job_dir"; then
  echo "STOP: Target job directory already exists: $job_dir"
  exit 1
fi

for prior in full-article-0001 full-article-0002; do
  prior_dir="/opt/fanaticosos-blog/jobs/$prior"
  if ! sudo -u "$service_account" -H \
    test -s "$prior_dir/failed-output.json"; then
    echo "STOP: Prior failure evidence is missing for $prior."
    exit 1
  fi
  if sudo test -e "$prior_dir/result.json"; then
    echo "STOP: Prior failed job has an accepted result: $prior"
    exit 1
  fi
done

echo "PASS: No process or target-job conflict; prior failures are preserved."

echo
echo "=== Host capacity ==="
free -h
swapon --show
df -h /

echo
echo "PASS: Translation acceptance preflight completed without mutation."
echo "NEXT: Install the verified version 9 template and create job $job_id."
