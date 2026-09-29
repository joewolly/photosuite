from pathlib import Path
from PIL import Image, ImageDraw
import json,sys
p=Path(sys.argv[1]);manifest=json.loads((p/'manifest.json').read_text())
for c in manifest['cases']:
 name=c['id'];g=c['geometry'];w,h=g['newWidth'],g['newHeight'];mw,mh=c['modelWidth'],c['modelHeight']
 raw=(p/f'{name}-model.bin').read_bytes();Image.frombytes('RGBA',(mw,mh),raw[:mw*mh*4]).save(p/f'{name}-model.png');Image.frombytes('L',(mw,mh),raw[mw*mh*4:]).save(p/f'{name}-mask.png')
 Image.frombytes('RGBA',(mw,mh),(p/f'{name}-output.bin').read_bytes()).save(p/f'{name}-raw.png')
 final=Image.frombytes('RGBA',(w,h),(p/f'{name}-preview.bin').read_bytes());final.save(p/f'{name}-final.png')
 sheet=Image.new('RGB',(w*2+24,h+50),(40,40,40));sheet.paste(Image.open(p/f'{name}.png'),(g['left'],g['top']+35));sheet.paste(final,(w+24,35),final);d=ImageDraw.Draw(sheet);d.rectangle((w+24+g['left'],35+g['top'],w+24+g['left']+g['width']-1,35+g['top']+g['height']-1),outline=(0,220,255));d.text((5,10),name+' / original',fill='white');d.text((w+29,10),'contained preview; cyan = protected',fill='white');sheet.save(p/f'{name}-comparison.jpg',quality=92)
