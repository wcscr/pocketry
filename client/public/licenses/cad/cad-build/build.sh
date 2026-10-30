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
# Public rebuilds always start from the original immutable image.
./build-wasm.sh generate > /work/generate.log 2>&1
python /work/selective-compile.py > /work/compile.log 2>&1
python - <<'PYALLOC'
from pathlib import Path
import hashlib,json,subprocess
root=Path('/work/sources/replicad-e4b05f67dc4e2393a876ce8c5064a9c93db05bf1')
config=root/'packages/replicad-opencascadejs/build-config/custom_build_single.yml'
patch=Path('/work/single-thread-emmalloc.patch')
expected=json.load(open('/work/allocator-patch-hashes.json'))
if hashlib.sha256(config.read_bytes()).hexdigest()!=expected['original']:raise RuntimeError('Link configuration is not the pinned original')
if hashlib.sha256(patch.read_bytes()).hexdigest()!=expected['patch']:raise RuntimeError('Allocator patch hash mismatch')
subprocess.run(['patch','--batch','--forward','-p1','-i',str(patch)],cwd=root,check=True)
if hashlib.sha256(config.read_bytes()).hexdigest()!=expected['patched']:raise RuntimeError('Patched link configuration hash mismatch')
PYALLOC
export OCJS_OUTPUT_DIR=/work/candidate
mkdir -p "$OCJS_OUTPUT_DIR"
./build-wasm.sh link /work/sources/replicad-e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad-opencascadejs/build-config/custom_build_single.yml > /work/link.log 2>&1
python - <<'PY'
from pathlib import Path
import hashlib,json
out=Path('/work/candidate')
record={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in out.iterdir() if p.is_file()}
flags=json.load(open(out/'replicad_single.provenance.json'))['linking']['emccFlags']
if [flag for flag in flags if flag.startswith('-sMALLOC=')]!=['-sMALLOC=emmalloc']:raise RuntimeError('Final link did not use emmalloc')
Path('/work/candidate-hashes.json').write_text(json.dumps(record,indent=2));print(json.dumps(record),flush=True)
PY
