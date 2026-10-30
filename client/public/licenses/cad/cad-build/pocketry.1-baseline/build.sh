#!/bin/bash
set -euo pipefail
cd /opencascade.js
python - <<'PY'
from pathlib import Path
import hashlib,json,shutil
p=Path('src/ocjs_bindgen/codegen/embind/class_.py');expected=json.load(open('/work/patch-hashes.json'))
assert hashlib.sha256(p.read_bytes()).hexdigest() in {expected['original'],expected['patched']}
shutil.copy('/work/sources/opencascade.js-ebd263f15337b440b391492af073662707e86482/src/ocjs_bindgen/codegen/embind/class_.py',p)
assert hashlib.sha256(p.read_bytes()).hexdigest()==expected['patched']
PY
# The image prunes generated C++; a resumed container already has the patched tree.
if ! python - <<'PYGEN'
from pathlib import Path
paths=list(Path('build/bindings').rglob('BRepCheck_Analyzer.cpp'))
raise SystemExit(0 if len(paths)==1 and 'raw_destructor<BRepCheck_Analyzer>' not in paths[0].read_text() else 1)
PYGEN
then
  ./build-wasm.sh generate > /work/generate.log 2>&1
fi
python /work/selective-compile.py > /work/compile.log 2>&1
export OCJS_OUTPUT_DIR=/work/candidate
mkdir -p "$OCJS_OUTPUT_DIR"
./build-wasm.sh link /work/sources/replicad-e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad-opencascadejs/build-config/custom_build_single.yml > /work/link.log 2>&1
python - <<'PY'
from pathlib import Path
import hashlib,json
out=Path('/work/candidate')
record={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in out.iterdir() if p.is_file()}
Path('/work/candidate-hashes.json').write_text(json.dumps(record,indent=2));print(json.dumps(record),flush=True)
PY
