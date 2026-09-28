from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageFilter
import json,numpy as np,sys
src=Path(__file__).resolve().parents[2]/'tests/fixtures/subject-corpus/v1';out=Path(sys.argv[1]);records=json.loads((src/'manifest.json').read_text())['cases'];scores=[]
for page in range(3):
 board=Image.new('RGB',(1440,4*230),(35,35,35));draw=ImageDraw.Draw(board)
 for row,item in enumerate(records[page*4:page*4+4]):
  w,h=item['width'],item['height'];im=Image.open(src/item['file']).convert('RGBA');masks={}
  for key in ['model','quick','quick-wide','border']:
   mask=Image.frombytes('L',(w,h),(out/(item['id']+'-'+key+'.bin')).read_bytes());masks[key]=mask;mask.save(out/(item['id']+'-'+key+'.png'))
  cut=Image.new('RGBA',(w,h),(60,125,160,255));cut.paste(im,mask=masks['model']);panels=[im.convert('RGB'),masks['model'].convert('RGB'),cut.convert('RGB'),masks['quick'].convert('RGB'),masks['quick-wide'].convert('RGB'),masks['border'].convert('RGB')]
  for col,panel in enumerate(panels):board.paste(ImageOps.contain(panel,(238,200)),(col*240,row*230+25));draw.text((col*240+4,row*230+6),item['id']+' '+['input','model','cutout','Quick Select','Quick broad dab','border estimate'][col],fill='white')
  if item['groundTruth']:
   label=np.asarray(Image.open(src/item['groundTruth']))/255;gt=label>=.5;entry={'id':item['id'],'noSelectionIoU':0}
   def boundary(a):
    im=Image.fromarray(a.astype(np.uint8)*255);return (np.asarray(im)!=np.asarray(im.filter(ImageFilter.MinFilter(3))))
   gb=boundary(gt);gd=np.asarray(Image.fromarray(gb.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(5)))>0
   for key,mask in masks.items():
    a=np.asarray(mask)/255;binary=a>=.5;union=(gt|binary).sum();pb=boundary(binary);pd=np.asarray(Image.fromarray(pb.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(5)))>0
    precision=(pb&gd).sum()/max(1,pb.sum());recall=(gb&pd).sum()/max(1,gb.sum())
    entry[key]={'iou':float((gt&binary).sum()/max(1,union)),'boundaryF2px':float(2*precision*recall/max(1e-12,precision+recall)),'coverageMAE':float(np.abs(label-a).mean())}
   scores.append(entry)
 board.save(out/('contact-'+str(page+1)+'.jpg'))
(out/'scores.json').write_text(json.dumps({'note':'Exact synthetic geometric labels only; these are not independent natural-image benchmark scores. Boundary F uses 2px Chebyshev tolerance. No aggregate marketing score.','cases':scores},indent=2)+'\n')
