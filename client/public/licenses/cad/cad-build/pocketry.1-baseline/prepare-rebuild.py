#!/usr/bin/env python3
"""Prepare the pinned source-only CAD repair build from served source archives.
Usage: python3 prepare-rebuild.py LICENSE_DIRECTORY BUILD_DIRECTORY
Requires Python 3.12+ (safe tar extraction), patch, and Docker for rebuild.sh.
"""
from pathlib import Path
import hashlib,io,json,shutil,subprocess,sys,tarfile
if len(sys.argv)!=3:raise SystemExit(__doc__)
licenses=Path(sys.argv[1]).resolve();work=Path(sys.argv[2]).resolve();recipe=Path(__file__).resolve().parent
if work.exists() and (not work.is_dir() or any(work.iterdir())):
 raise RuntimeError('Build directory must be new or empty; existing contents were not changed')
work.mkdir(parents=True,exist_ok=True)
sources={
 'ocjs':('1e0342c8dbdc04d1835c776d5e95ab25fcad56a5f4cafcbecad92a959b6b00b7','opencascade.js-ebd263f15337b440b391492af073662707e86482'),
 'replicad':('92180710da11a6e67ab75eaac8b494b29d32011415c22e29f7fecb1c796da783','replicad-e4b05f67dc4e2393a876ce8c5064a9c93db05bf1'),
}
record=[]
for name,(expected,folder) in sources.items():
 parts=sorted(licenses.glob(name+'.tar.gz.part*'))
 if not parts:raise RuntimeError(f'Missing complete served {name} source parts')
 raw=b''.join(p.read_bytes() for p in parts);actual=hashlib.sha256(raw).hexdigest()
 if actual!=expected:raise RuntimeError(f'{name} source SHA256 mismatch: {actual}')
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:archive.extractall(work/'sources',filter='data')
 record.append({'name':name,'sha256':actual,'bytes':len(raw),'parts':[p.name for p in parts]})
for name in ['native-destructors.patch','patch-hashes.json','original-destructors.json','build.sh','selective-compile.py','verify-destructors.mjs','verify-analyzer-lifetime.mjs','verify-owned-shapes.mjs','compare-destructors.mjs','destructor-exceptions.json']:
 source=recipe/name;target=work/name
 if name=='native-destructors.patch' and not source.exists():source=recipe.parent/name
 if source.resolve()!=target.resolve():shutil.copyfile(source,target)
compiler=work/'sources'/sources['ocjs'][1];generator=compiler/'src/ocjs_bindgen/codegen/embind/class_.py';hashes=json.loads((work/'patch-hashes.json').read_text());actual=hashlib.sha256(generator.read_bytes()).hexdigest()
if hashlib.sha256((work/'native-destructors.patch').read_bytes()).hexdigest()!=hashes['patch']:raise RuntimeError('Repair patch hash mismatch')
if actual!=hashes['original']:raise RuntimeError('Extracted generator does not match the pinned original')
subprocess.run(['patch','--batch','--forward','-p1','-i',str(work/'native-destructors.patch')],cwd=compiler,check=True)
if hashlib.sha256(generator.read_bytes()).hexdigest()!=hashes['patched']:raise RuntimeError('Patched generator hash mismatch')
(work/'source-inputs.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
