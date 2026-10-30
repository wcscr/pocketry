#!/bin/bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  echo 'Usage: bash rebuild.sh LICENSE_DIRECTORY NEW_BUILD_DIRECTORY' >&2
  exit 2
fi
recipe_dir="$(cd "$(dirname "$0")" && pwd)"
python3 "$recipe_dir/prepare-rebuild.py" "$1" "$2"
work_dir="$(cd "$2" && pwd)"
image_ref='ghcr.io/taucad/opencascade.js@sha256:b900017985fc32e296e01531a3483d4041fd39c51e9a0be365e97e5295f15da7'
# The compiler contains Emscripten5.0.1, original generated bindings and immutable
# OCCT8.0.1 libraries. Download is separate from the network-disabled build.
docker pull --platform linux/arm64 "$image_ref"
docker image inspect "$image_ref" > "$work_dir/compiler-image-inspect.json"
docker run --rm --platform linux/arm64 --network none --cpus 4 --memory 8g --memory-swap 8g \
  --entrypoint /bin/bash -v "$work_dir:/work" "$image_ref" /work/build.sh \
  > "$work_dir/build.log" 2>&1
