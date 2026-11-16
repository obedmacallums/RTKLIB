#!/usr/bin/env bash
# Bring the fork up to date with upstream RTKLIB:
#   main  <- fast-forward to upstream/main (stays identical to upstream)
#   wasm  <- merge main (the WebAssembly files are only added, never edited)
# Pushing wasm triggers the GitHub Actions build and test.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/rtklibexplorer/RTKLIB.git}"
cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
git fetch upstream main
git fetch origin

if git merge-base --is-ancestor upstream/main origin/wasm; then
  echo "Already up to date with upstream."
  exit 0
fi

git push origin upstream/main:refs/heads/main
git checkout wasm
git merge --ff-only origin/wasm
git merge --no-edit upstream/main
git push origin wasm
echo "Done. Build: bash wasm/build.sh   (or wait for GitHub Actions)"
