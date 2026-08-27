#!/bin/bash
# Rebuilds client/public/opencv/opencv.js from OpenCV source.
#
# The bundle is a custom build rather than a prebuilt distribution because the
# app needs the aruco module (auto-calibration markers), which neither the
# official opencv.js releases nor @techstark/opencv-js compile in. Since
# OpenCV 4.7 aruco lives in mainline `objdetect`, so the default JS whitelist
# (platforms/js/opencv_js.config.py) already exports ArucoDetector & friends —
# no config changes needed, only a build.
#
# Requirements: docker (the emscripten/emsdk image does the compiling).
# Takes ~15–30 minutes. Output: a single-file opencv.js with embedded wasm.
#
# Keep OPENCV_TAG in lockstep with @techstark/opencv-js's OpenCV version so
# the node-side tests (which use that package for the imgproc agreement suite)
# exercise the same OpenCV behaviour the browser ships.
set -euo pipefail

OPENCV_TAG="4.11.0"
EMSDK_IMAGE="emscripten/emsdk:3.1.64"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${OPENCV_BUILD_DIR:-$REPO_ROOT/.opencv-build}"
DEST="$REPO_ROOT/client/public/opencv/opencv.js"

mkdir -p "$WORK"
cd "$WORK"

if [ ! -d opencv ]; then
  echo "== cloning opencv $OPENCV_TAG =="
  git clone --depth 1 --branch "$OPENCV_TAG" https://github.com/opencv/opencv.git
fi

echo "== building via $EMSDK_IMAGE =="
docker run --rm -v "$WORK/opencv:/src" "$EMSDK_IMAGE" \
  bash -c "cd /src && python3 ./platforms/js/build_js.py build_js --build_wasm"

ARTIFACT="$WORK/opencv/build_js/bin/opencv.js"
echo "== verifying the artifact in node =="
node -e "
Promise.resolve(require('$ARTIFACT')).then((cv) => {
  const need = ['aruco_ArucoDetector', 'getPredefinedDictionary', 'generateImageMarker', 'threshold', 'findContours'];
  for (const name of need) {
    if (typeof cv[name] !== 'function') { console.error('MISSING ' + name); process.exit(1); }
  }
  console.log('artifact OK');
  process.exit(0);
});"

cp "$ARTIFACT" "$DEST"
echo "== installed $DEST =="
ls -la "$DEST"
echo "Run the oracle suite: npx vitest run client/src/lib/calibrate"
