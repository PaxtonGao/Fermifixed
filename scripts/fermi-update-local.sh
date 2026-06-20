#!/usr/bin/env bash
set -euo pipefail

repo="${FERMI_LOCAL_REPO:-/Users/paxton/Fermifixed}"
home="${FERMI_HOME:-$HOME/.fermi}"
bin="$home/bin/fermi"

cd "$repo"
git pull --ff-only
bun run build

mkdir -p "$home/bin"
if [ -f "$bin" ]; then
  cp "$bin" "$bin.backup-$(date +%Y%m%d%H%M%S)"
fi
cp "$repo/build/fermi" "$bin"
chmod +x "$bin"
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --force --sign - "$bin"
fi

echo "Updated $bin from $repo"
