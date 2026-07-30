#!/usr/bin/env bash
set -euo pipefail

if [[ "$(hostname)" != "papabear" ]]; then
  echo "STOP: Wrong server. Expected papabear."
  exit 1
fi

if [[ "$(id -u)" != "0" ]]; then
  echo "STOP: Run this installer through sudo."
  exit 1
fi

repository="/opt/fanaticosos-blog/repository"
helper_source="$repository/deploy/admin/fanaticosos-blog-admin"
sudoers_source="$repository/deploy/admin/fanaticosos-blog-admin.sudoers"
helper_target="/usr/local/sbin/fanaticosos-blog-admin"
sudoers_target="/etc/sudoers.d/fanaticosos-blog-admin"

for target in "$helper_target" "$sudoers_target"; do
  if [[ -e "$target" ]]; then
    echo "STOP: Target already exists: $target"
    exit 1
  fi
done

bash -n "$helper_source"
visudo -cf "$sudoers_source" >/dev/null

install -o root -g root -m 0755 "$helper_source" "$helper_target"
install -o root -g root -m 0440 "$sudoers_source" "$sudoers_target"

visudo -cf "$sudoers_target" >/dev/null

echo "PASS: Restricted Fanaticosos administration helper installed."
echo "PASS: No service, job, listener, or deployment was started."
