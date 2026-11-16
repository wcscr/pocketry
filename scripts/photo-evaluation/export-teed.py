import sys, types, json, time, hashlib, argparse, subprocess
from pathlib import Path
import torch, onnx, cv2, numpy as np
parser=argparse.ArgumentParser(description="Local-only fixed-shape TEED/OpenCV evaluation. No model is bundled by Pocketry.")
parser.add_argument('--upstream',type=Path,required=True,help='Checkout of xavysp/TEED at 40fa4b1391dc6424f88989d0ca75d5b592c8681d')
parser.add_argument('--image',type=Path,required=True,help='Local input photograph (OpenCV decode, BGR)')
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--photo-results',type=Path,help='Optional evaluate-photo-refinement.ts output directory for multi-photo boundary evaluation')
args=parser.parse_args();root=args.output;root.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','-C',str(args.upstream),'rev-parse','HEAD'],text=True).strip()
if revision != '40fa4b1391dc6424f88989d0ca75d5b592c8681d': raise ValueError('Unexpected TEED revision')
sys.path.insert(0,str(args.upstream))
# Only a CLI parameter-count utility is imported by ted.py. Avoid importing
# its unrelated image-saving/training metric dependencies for this evaluation.
util=types.ModuleType('utils.img_processing')
util.count_parameters=lambda model:sum(p.numel() for p in model.parameters())
sys.modules['utils.img_processing']=util
from ted import TED
expected='0322caf70f588355aaaf59c2bf5872b21a4b7e9f679971a7a3bb1f69b56a01ba'
assert hashlib.sha256((args.upstream/'checkpoints/BIPED/5/5_model.pth').read_bytes()).hexdigest()==expected, 'Unexpected checkpoint'
(root/'LICENSE-TEED.txt').write_bytes((args.upstream/'LICENSE').read_bytes())
model=TED().eval()
checkpoint=args.upstream/'checkpoints/BIPED/5/5_model.pth'
model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
class Fused(torch.nn.Module):
    def __init__(self,m):
        super().__init__(); self.model=m
    def forward(self,x): return torch.sigmoid(self.model(x)[-1])
wrapped=Fused(model).eval()
torch.set_num_threads(1)
image=cv2.imread(str(args.image))
# BIPED defaults, BGR bytes (no division by 255), fixed letterboxed 512 square.
if image is None: raise ValueError('Cannot decode image')
height,width=image.shape[:2]
scale=512/max(width,height)
w,h=round(width*scale),round(height*scale)
small=cv2.resize(image,(w,h),interpolation=cv2.INTER_LINEAR)
padleft,padtop=(512-w)//2,(512-h)//2
frame=cv2.copyMakeBorder(small,padtop,512-h-padtop,padleft,512-w-padleft,cv2.BORDER_REPLICATE)
frame.tofile(root/'input-bgr.bin')
mean=np.array([103.939,116.779,123.68],np.float32)
x=torch.from_numpy((frame.astype(np.float32)-mean).transpose(2,0,1).copy()[None])
times=[]
with torch.inference_mode():
    for i in range(4):
        t=time.perf_counter(); y=wrapped(x); times.append((time.perf_counter()-t)*1000)
    y.numpy().tofile(root/'reference-f32.bin')
    torch.onnx.export(wrapped,x,str(root/'teed-512-fp32.onnx'),input_names=['image'],output_names=['edge'],opset_version=13,dynamo=False)
graph=onnx.load(root/'teed-512-fp32.onnx')
onnx.checker.check_model(graph)
from collections import Counter
report={'upstreamRevision':revision,'torchVersion':torch.__version__,'onnxVersion':onnx.__version__,'checkpoint':'checkpoints/BIPED/5/5_model.pth','checkpointSha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'parameters':sum(p.numel() for p in model.parameters()),'meanBGR':mean.tolist(),'input':list(x.shape),'output':list(y.shape),'padding':[padleft,padtop,w,h],'torchMs':times,'ops':dict(Counter(n.op_type for n in graph.graph.node)),'onnxBytes':(root/'teed-512-fp32.onnx').stat().st_size,'onnxSha256':hashlib.sha256((root/'teed-512-fp32.onnx').read_bytes()).hexdigest()}
(root/'export.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))

if args.photo_results:
    p=args.photo_results
    report=[]
    for name in [f.stem for f in sorted(p.glob('*.rgba'))]:
        meta=json.loads((p/(name+'.json')).read_text());width,height=meta['width'],meta['height']
        rgba=np.fromfile(p/(name+'.rgba'),np.uint8).reshape(height,width,4)
        for size in [512,256]:
            scale=size/max(width,height);w,h=round(width*scale),round(height*scale)
            left,top=(size-w)//2,(size-h)//2
            small=cv2.resize(rgba[:,:,:3][:,:,::-1],(w,h),interpolation=cv2.INTER_LINEAR)
            frame=cv2.copyMakeBorder(small,top,size-h-top,left,size-w-left,cv2.BORDER_REPLICATE)
            x=torch.from_numpy((frame.astype(np.float32)-np.array([103.939,116.779,123.68],np.float32)).transpose(2,0,1).copy()[None])
            with torch.inference_mode():
                t=time.perf_counter();edge=wrapped(x).numpy()[0,0];elapsed=(time.perf_counter()-t)*1000
            edge=cv2.resize(edge[top:top+h,left:left+w],(width,height),interpolation=cv2.INTER_LINEAR)
            edge.tofile(p/(name+f'-teed{size}.f32'))
            cv2.imwrite(str(p/(name+f'-teed{size}.png')),np.clip((edge-0.43)*450,0,255).astype(np.uint8))
            report.append({'image':name,'size':size,'torchMs':elapsed,'padding':[left,top,w,h]})
    # Validate resize/padding inversion against pixel centers, including a non-square
    # image and shifts by a whole network stride. Not a claim of subpixel model truth.
    x=torch.zeros(1,3,512,512);x[:,:,128:384,128:384]=100
    with torch.inference_mode():
     a=wrapped(x).numpy()[0,0];b=wrapped(torch.roll(x,8,dims=3)).numpy()[0,0]
    shift=float(np.abs(a[32:-32,32:-40]-b[32:-32,40:-32]).max())
    (p/'neural-evaluation.json').write_text(json.dumps({'images':report,'strideShiftMaxError':shift},indent=2))
    print('shift alignment max error',shift)
