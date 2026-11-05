"""Prepare every published sample photo plus locally available original shots.
No network access. Decode/EXIF-transpose and bilinear fit inside the unchanged
800x600 working cap. Original-photo regions are explicitly recorded fractions.
"""
import argparse, hashlib, json, math
from pathlib import Path
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--downloads', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
args.output.mkdir(parents=True, exist_ok=True)
cases = []

def prepare(name, path, group, region=None, sample=None):
    image = ImageOps.exif_transpose(Image.open(path)).convert('RGBA')
    scale = min(1, 800 / image.width, 600 / image.height)
    size = (round(image.width * scale), round(image.height * scale))
    image = image.resize(size, Image.Resampling.BILINEAR)
    roi = None
    if region:
        left, top, right, bottom = region
        box = (math.floor(left*size[0]), math.floor(top*size[1]), math.ceil(right*size[0]), math.ceil(bottom*size[1]))
        roi = dict(x=box[0], y=box[1], width=box[2]-box[0], height=box[3]-box[1])
        image = image.crop(box)
    image.save(args.output / (name+'.png'))
    raw = args.output / (name+'.rgba')
    raw.write_bytes(image.tobytes())
    cases.append(dict(name=name, path=str(raw.resolve()), width=image.width, height=image.height,
        group=group, sample=sample, sourceFile=path.relative_to(args.downloads).as_posix() if group=='original' else path.relative_to(repo).as_posix(),
        sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(), workingSize=list(size), region=roi))

provenance = json.loads((repo/'samples/source-files.json').read_text())
for sample in provenance['samples']:
    for photo in sample.get('photos', []):
        path = repo/'samples'/sample['directory']/photo['file']
        if hashlib.sha256(path.read_bytes()).hexdigest() != photo['sha256']:
            raise ValueError('Published fixture changed: '+str(path))
        prepare(sample['directory']+'-'+path.stem, path, 'published', sample=sample['directory'])
# Fractions are manual selections of photographed tools, not algorithm outputs.
originals = [
 ('airduster-nozzle','20260903_055957.jpg',[.34,.31,.65,.76],'wolfbox-mf70-airduster-kit'),
 ('airduster-body','20260903_060015.jpg',[.34,.28,.79,.80],'wolfbox-mf70-airduster-kit'),
 ('airduster-pair','20260903_060045.jpg',[.25,.24,.79,.78],'wolfbox-mf70-airduster-kit'),
 ('airduster-angle-nozzle','20260903_060108.jpg',[.30,.30,.61,.60],'wolfbox-mf70-airduster-kit'),
 ('ryobi-original','20260907_080053.jpg',[.18,.27,.86,.81],'ryobi-cutter'),
 ('mouldline-original','20260913_110847.jpg',[.40,.23,.52,.72],'mouldline-remover'),
 ('stapler-original','20260913_111254.jpg',[.33,.14,.73,.85],'stapler'),
 ('caliper-original','20260919_101355.jpg',[.32,.36,.62,.63],'caliper-storage'),
 ('mouldline-distant','20260919_102003.jpg',[.43,.35,.52,.62],'mouldline-remover'),
 ('wiha-150-original','20260921_163212.jpg',[.30,.15,.66,.76],'wiha-drivers'),
 ('bessey-original','20260927_164630.jpg',[.38,.43,.56,.70],'bessey-gerber'),
 ('gerber-close','20260927_164649.jpg',None,'bessey-gerber'),
 ('gerber-distant','20260927_164652.jpg',[.36,.33,.56,.69],'bessey-gerber'),
 ('wiha-60-original','20260928_092453.jpg',[.54,.29,.63,.65],'wiha-60mm-drivers'),
 ('wiha-50-original','20260928_092506.jpg',[.57,.31,.65,.64],'wiha-50mm-drivers'),
 ('wiha-40-original','20260928_092528.jpg',[.55,.32,.63,.62],'wiha-40mm-drivers'),
]
originals += [
 ('wire-strippers-original','test_part.jpg',[.31,.10,.67,.86],'wire-strippers'),
 ('airduster-body-early','20260824_151212.jpg',[.20,.23,.62,.71],'wolfbox-mf70-airduster-kit'),
 ('airduster-nozzle-early','20260824_152225.jpg',[.35,.24,.61,.67],'wolfbox-mf70-airduster-kit'),
]
# Earlier checkerboard-mat photographs are adversarial background cases.
for filename in ['20260812_164339.jpg','20260812_164350.jpg','20260812_171044.jpg','20260812_171049.jpg','20260812_171808.jpg','20260812_171814.jpg']:
    originals.append(('caliper-mat-'+Path(filename).stem,filename,None,'caliper-storage'))
for filename in ['20260812_173148.jpg','20260812_173156.jpg','GridshotTestPhotos/20260817_124249.jpg','GridshotTestPhotos/20260817_124240.jpg','GridshotTestPhotos/20260817_124246.jpg']:
    originals.append(('wire-mat-'+Path(filename).stem,filename,None,'wire-strippers'))
missing=[]
if args.downloads:
    for name, filename, region, sample in originals:
        path=args.downloads/filename
        if not path.exists():
            matches=sorted(args.downloads.rglob(Path(filename).name))
            if len(matches)==1: path=matches[0]
            elif matches and len({hashlib.sha256(p.read_bytes()).hexdigest() for p in matches})==1: path=matches[0]
        if path.exists(): prepare(name,path,'original',region,sample)
        else: missing.append(filename)
(args.output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
(args.output/'coverage.json').write_text(json.dumps(dict(publishedPhotos=sum(c['group']=='published' for c in cases),originalPhotos=sum(c['group']=='original' for c in cases),missingOriginals=missing),indent=2)+'\n')
print('Prepared',len(cases),'photos; missing:',missing)
