"""Render per-prompt masks and independent geometric metrics from the opt-in runner."""
from pathlib import Path
import json,sys
from PIL import Image,ImageDraw
import numpy as np
root=Path(__file__).resolve().parents[2];corpus=root/'tests/fixtures/prompted-corpus/v1';results=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);metrics=[]
def boundary(a):
 eroded=a.copy()
 for dy,dx in [(-1,0),(1,0),(0,-1),(0,1)]:
  shifted=np.zeros_like(a);sy=slice(max(0,dy),min(a.shape[0],a.shape[0]+dy));sx=slice(max(0,dx),min(a.shape[1],a.shape[1]+dx));shifted[sy,sx]=a[slice(max(0,-dy),min(a.shape[0],a.shape[0]-dy)),slice(max(0,-dx),min(a.shape[1],a.shape[1]-dx))];eroded &= shifted
 return a & ~eroded

def dilate(a):
 p=np.pad(a,2);return np.logical_or.reduce([p[y:y+a.shape[0],x:x+a.shape[1]] for y in range(5) for x in range(5)])
for item in json.loads((corpus/'manifest.json').read_text())['cases']:
 im=Image.open(corpus/item['file']).convert('RGB');w,h=im.size;cellw=280;cellh=round(h*cellw/w);sheet=Image.new('RGB',(cellw*3,(cellh+32)*2),(35,35,35));row=[]
 previews=[('Source',im)]
 for seq in item['sequences']:
  a=np.frombuffer((results/(item['id']+'-'+seq['name']+'.bin')).read_bytes(),dtype=np.uint8).reshape(h,w);mask=Image.fromarray(a);mask.save(out/(item['id']+'-'+seq['name']+'.png'))
  bg=Image.new('RGB',(w,h),(65,65,65));bg.paste(im,mask=mask);previews.append((seq['name'],bg));rec={'sequence':seq['name'],'foregroundPixels':int((a>=128).sum())}
  if item['groundTruth']:
   gt=np.array(Image.open(corpus/item['groundTruth']))>=128;pred=a>=128;rec['iou']=float((gt&pred).sum()/max(1,(gt|pred).sum()));gb=boundary(gt);pb=boundary(pred);precision=float((pb&dilate(gb)).sum()/max(1,pb.sum()));recall=float((gb&dilate(pb)).sum()/max(1,gb.sum()));rec['boundaryF2px']=2*precision*recall/max(1e-12,precision+recall)
  row.append(rec)
 for i,(name,pic) in enumerate(previews):
  x=(i%3)*cellw;y=(i//3)*(cellh+32);sheet.paste(pic.resize((cellw,cellh)),(x,y+32));ImageDraw.Draw(sheet).text((x+6,y+8),name,fill='white')
 sheet.save(out/(item['id']+'-contact.jpg'),quality=88);metrics.append({'id':item['id'],'groundTruth':item['groundTruth'],'results':row})
(out/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
