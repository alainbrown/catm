#!/usr/bin/env bash
# Build a Chrome Web Store upload artefact from extension/.
# Output: ./extension.zip at the repo root, with manifest.json at the zip's root.
set -euo pipefail

cd "$(dirname "$0")/.."

out="$(pwd)/extension.zip"
rm -f "$out"

# Prefer the host's zip/unzip when present (CI runners have them, so we avoid
# pulling a container for nothing). Fall back to a tiny Alpine container on
# machines like the user's code-server box where zip is not installed.
# -X drops extra attributes / macOS junk that some reviewers flag.
if command -v zip >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1; then
  (cd extension && zip -r -X "$out" . -x '.*' -x '*/.*' -x '*.DS_Store') > /dev/null
  echo "wrote $out"
  ls -lh "$out"
  echo
  echo "contents:"
  unzip -l "$out"
else
  docker run --rm -v "$(pwd)":/work -w /work alpine:3.21 sh -c "
    apk add --no-cache --quiet zip > /dev/null
    cd extension && zip -r -X /work/extension.zip . -x '.*' -x '*/.*' -x '*.DS_Store' > /dev/null
  "
  echo "wrote $out"
  ls -lh "$out"
  echo
  echo "contents:"
  docker run --rm -v "$(pwd)":/work -w /work alpine:3.21 sh -c "apk add --no-cache --quiet unzip > /dev/null && unzip -l /work/extension.zip"
fi
