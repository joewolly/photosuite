from pathlib import Path
from PIL import Image,ImageDraw
import json,sys
p=Path(sys.argv[1]);manifest=json.loads((p/'manifest.json').read_text());panels=[]
for c in manifest['cases']:
 name=c['id'];w,h=c['width'],c['height']
 if not (p/f'{name}-contained.bin').exists():continue
 source=Image.frombytes('RGBA',(w,h),(p/f'{name}.bin').read_bytes());mask=Image.frombytes('L',(w,h),(p/f'{name}-selection.bin').read_bytes());contained=Image.frombytes('RGBA',(w,h),(p/f'{name}-contained.bin').read_bytes());raw=Image.frombytes('RGBA',(c['modelWidth'],c['modelHeight']),(p/f'{name}-output.bin').read_bytes())
 for key,im in [('source',source),('selection',mask),('contained',contained),('raw',raw)]:im.save(p/f'{name}-{key}.png')
 row=Image.new('RGB',(960,280),(35,35,35));d=ImageDraw.Draw(row);d.text((8,5),name+': '+c['prompt'],fill='white')
 for k,im in enumerate([source,mask.convert('RGBA'),contained,raw]):
  im=im.copy();im.thumbnail((232,244));bg=Image.new('RGBA',im.size,(180,180,180,255));bg.alpha_composite(im);row.paste(bg.convert('RGB'),(k*240+4,30))
 row.save(p/f'{name}-comparison.jpg',quality=90);panels.append(row)
 if len(panels)==6:
  sheet=Image.new('RGB',(960,len(panels)*280));[sheet.paste(im,(0,i*280)) for i,im in enumerate(panels)];sheet.save(p/f'sheet-{name}.jpg');panels=[]
if panels:
 sheet=Image.new('RGB',(960,len(panels)*280));[sheet.paste(im,(0,i*280)) for i,im in enumerate(panels)];sheet.save(p/'sheet-final.jpg')
