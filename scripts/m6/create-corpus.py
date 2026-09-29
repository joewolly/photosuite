"""Bounded, correlated M6 probes. Inherited photographic provenance, synthetic CC0 masks."""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib,json,sys
root=Path(__file__).resolve().parents[2];out=root/'tests/fixtures/generative-corpus/v1';out.mkdir(parents=True,exist_ok=True)
raw=Path(sys.argv[1]);raw.mkdir(parents=True,exist_ok=True)
parents={c['id']:c for c in json.loads((root/'tests/fixtures/subject-corpus/v1/manifest.json').read_text())['cases']}
rows=[]
def add(name,source,box,prompt,kind='hard',seed=42):
 im=Image.open(root/f'tests/fixtures/subject-corpus/v1/{source}.png').convert('RGBA') if source else Image.new('RGBA',(513,385),(211,199,177,255))
 if name=='transparent':
  im=Image.new('RGBA',(321,257),(99,33,88,0));ImageDraw.Draw(im).rounded_rectangle((60,30,250,230),20,fill=(30,110,150,180))
 if name=='flat-remove':ImageDraw.Draw(im).ellipse((210,130,300,225),fill=(160,40,30,255))
 w,h=im.size; mask=Image.new('L',(w,h));d=ImageDraw.Draw(mask)
 if kind=='lasso':d.polygon(box,fill=255)
 else:
  x,y,bw,bh=box;d.rectangle((x,y,x+bw-1,y+bh-1),fill=255)
  if kind=='soft':
   for inset in range(8):d.rectangle((x+inset,y+inset,x+bw-1-inset,y+bh-1-inset),outline=round(255*(inset+1)/9))
 im.save(out/f'{name}.png');mask.save(out/f'{name}-selection.png')
 (raw/f'{name}.bin').write_bytes(im.tobytes());(raw/f'{name}-selection.bin').write_bytes(mask.tobytes())
 rec={'id':name,'width':w,'height':h,'prompt':prompt,'seed':seed,'selectionKind':kind,'source':parents[source]['source'] if source else 'Synthetic fixture from scripts/m6/create-corpus.py','license':parents[source]['license'] if source else 'CC0','inputSha256':hashlib.sha256((out/f'{name}.png').read_bytes()).hexdigest(),'selectionSha256':hashlib.sha256((out/f'{name}-selection.png').read_bytes()).hexdigest()};rows.append(rec)
add('context-free','object',(155,35,265,285),'')
add('replace-cup','object',(155,35,265,285),'a small blue ceramic coffee mug on a table')
add('replace-cup-b','object',(155,35,265,285),'a small blue ceramic coffee mug on a table',seed=43)
add('replace-cup-c','object',(155,35,265,285),'a small blue ceramic coffee mug on a table',seed=44)
add('material','product',(78,36,102,245),'a polished wooden bottle')
add('add-object',None,(180,100,170,190),'a small red ceramic coffee mug, studio product photograph')
add('clothing','person',(125,285,210,210),'a red leather jacket')
add('fur-adjacent','fur',[(0,0),(150,0),(130,65),(75,90),(0,60)],'green grass','lasso')
add('architecture','people',(0,5,160,420),'white marble columns')
add('textured','object',(380,270,145,100),'wooden tabletop','soft')
add('flat-remove',None,(200,120,111,116),'')
add('small','object',(240,160,21,25),'red flower')
add('large','object',(30,20,510,350),'a bowl of oranges on a wooden table')
add('canvas-edge','fur',(0,0,140,150),'green leaves')
add('transparent',None,(20,70,200,150),'a yellow flower','soft')
add('soft','object',(155,35,265,285),'a blue ceramic coffee mug','soft')
add('text-logo',None,(180,100,170,190),'a white mug with the word PHOTOSUITE written on it')
manifest={'version':1,'notes':'Bounded correlated probes, not a universal benchmark. Selections are manual geometric authority masks; original photographs inherited with provenance.','cases':rows}
for p in [out,raw]:(p/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
