"""Bounded M8 probes: inherited photos and explicitly synthetic landscape/texture/alpha."""
from pathlib import Path
from PIL import Image, ImageDraw
import json, hashlib, sys
root=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
parents={c['id']:c for c in json.loads((root/'tests/fixtures/subject-corpus/v1/manifest.json').read_text())['cases']}
rows=[]
def add(name,source,edges,prompt=''):
 if source in parents:
  im=Image.open(root/f'tests/fixtures/subject-corpus/v1/{source}.png').convert('RGBA');im.thumbnail((384,320))
  provenance={k:parents[source][k] for k in ['source','license']}
 else:
  im=Image.new('RGBA',(321,257),(189,210,224,255));d=ImageDraw.Draw(im)
  if source=='landscape':
   d.rectangle((0,155,321,257),fill=(92,115,67,255));d.polygon([(0,155),(70,51),(148,147),(218,73),(321,164)],fill=(93,109,124,255));d.polygon([(45,88),(70,51),(98,91),(77,78),(64,86)],fill=(234,238,240,255));d.polygon([(0,230),(109,188),(321,245),(321,257),(0,257)],fill=(156,141,112,255))
  if source=='texture':
   for y in range(0,257,24):
    for x in range(-24,321,48):d.rectangle((x+(y//24%2)*24,y,x+44+(y//24%2)*24,y+20),fill=(159,104,81,255))
  if source=='lines':
   d.rectangle((0,110,321,257),fill=(185,176,156,255))
   for x in range(-400,750,70):d.line((160,100,x,257),fill=(40,45,48,255),width=3)
   for y in [124,144,174,217,250]:d.line((0,y,321,y),fill=(40,45,48,255),width=2)
  if source=='transparent':
   im=Image.new('RGBA',(321,257),(0,0,0,0));ImageDraw.Draw(im).rounded_rectangle((32,35,320,222),20,fill=(47,118,146,160))
  provenance={'source':'Synthetic CC0 probe from scripts/m8/create-corpus.py','license':'CC0-1.0'}
 im.save(out/f'{name}.png');(out/f'{name}.bin').write_bytes(im.tobytes())
 rows.append({'id':name,'width':im.width,'height':im.height,'expansion':dict(zip(['left','top','right','bottom'],edges)),'prompt':prompt,'seed':42,'sourceSha256':hashlib.sha256(im.tobytes()).hexdigest(),**provenance})
add('landscape-left','landscape',(96,0,0,0),'continue the mountain landscape')
add('landscape-right','landscape',(0,0,96,0),'continue the mountain landscape')
add('sky-top','landscape',(0,96,0,0),'blue sky with soft clouds')
add('ground-bottom','landscape',(0,0,0,96),'continue the grass and ground')
add('portrait-headroom','person',(0,80,0,0),'')
add('full-body-surroundings','people',(64,0,64,48),'continue the courtyard surroundings')
add('architecture','people',(0,0,96,0),'continue the white colonnade')
add('repeated-texture','texture',(96,0,0,0),'continue the brick wall')
add('flat-background','flat',(0,0,96,0),'')
add('perspective-lines','lines',(96,0,0,0),'continue the tiled floor')
add('edge-subject','fur',(0,0,96,0),'')
add('transparent','transparent',(0,0,96,0),'a soft blue background')
add('two-side','object',(64,0,64,0),'wooden table')
add('four-side','landscape',(48,48,48,48),'continue the mountain landscape')
add('empty-prompt','landscape',(0,0,96,0),'')
add('explicit-prompt','landscape',(0,96,0,0),'blue sky with white fluffy clouds')
(out/'manifest.json').write_text(json.dumps({'version':1,'notes':'16 correlated bounded probes. Landscape, lines, brick and flat/alpha cases are synthetic, not photographic benchmark evidence. Four inherited public-domain/CC0 photos.','cases':rows},indent=2)+'\n')
