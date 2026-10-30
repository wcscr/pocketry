"""Recompile the original artifact's no-op-destructor classes against pinned caches.
Uses the upstream compiler API and its exact compile flags/identity tracking.
No OCCT geometry algorithms or kernel objects are changed.
"""
from pathlib import Path
import json,sys,os,multiprocessing
from functools import partial
root=Path('/opencascade.js');sys.path.insert(0,str(root/'src'))
for key,value in json.load(open(root/'build/build-flags.json')).items():os.environ[key]=value
import compileBindings as compiler
compiler.validate_build_flags()
def main():
 original=json.load(open('/work/original-destructors.json'))
 requested={r['name'] for r in original['records'] if r['isEmptyFunction']}
 files=[p for p in (root/'build/bindings').rglob('*.cpp') if p.stem in requested]
 found={p.stem for p in files};missing=sorted(requested-found)
 report={'requested':sorted(requested),'found':sorted(found),'missing':missing,'results':[]}
 # Every originally registered empty-destructor class must have a concrete producer.
 # There are no missing custom-wrapper exceptions in this pinned artifact.
 if missing:raise RuntimeError(f'Cannot rebuild original empty-destructor classes: {missing}')
 args={'threading':'single-threaded','identity_context':compiler._shared_identity_context()}
 with multiprocessing.Pool(processes=4) as pool:
  for result in pool.imap_unordered(partial(compiler.buildOneFile,args),sorted(map(str,files))):
   report['results'].append(result)
 Path('/work/selective-compile.json').write_text(json.dumps(report,indent=2))
 failed=[r for r in report['results'] if r['status']=='failed']
 print(json.dumps({'selected':len(files),'succeeded':sum(r['status']=='succeeded' for r in report['results']),'cached':sum(r['status']=='cached' for r in report['results']),'failed':failed}),flush=True)
 if failed:raise SystemExit(1)

if __name__ == '__main__':
 main()
