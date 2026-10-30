#!/bin/bash
set -euo pipefail
recipe_dir="$(cd "$(dirname "$0")" && pwd)"
exec bash "$recipe_dir/cad-build/rebuild.sh" "$@"
