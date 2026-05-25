#!/usr/bin/env bash
# Build a Chrome Web Store upload artefact from extension/.
# Output: ./extension.zip at the repo root, with manifest.json at the zip's root.
set -euo pipefail

cd "$(dirname "$0")/.."

out="$(pwd)/extension.zip"
rm -f "$out"

# Use a tiny Alpine container so this works without zip on the host. The
# zip(1) CLI is what Chrome expects (manifest.json must sit at the zip root,
# no parent folder), -X drops extra attributes / macOS junk that some reviewers
# flag.
docker run --rm -v "$(pwd)":/work -w /work alpine:3.21 sh -c "
  apk add --no-cache --quiet zip > /dev/null
  cd extension && zip -r -X /work/extension.zip . -x '.*' -x '*/.*' -x '*.DS_Store' > /dev/null
"

echo "wrote $out"
ls -lh "$out"
echo
echo "contents:"
docker run --rm -v "$(pwd)":/work -w /work alpine:3.21 sh -c "apk add --no-cache --quiet unzip > /dev/null && unzip -l /work/extension.zip"
