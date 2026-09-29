from PIL import Image,ImageDraw
from pathlib import Path
import sys,json
base=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((base/'manifest.json').read_text())
for c in manifest['cases']:
 w,h=c['width']*4,c['height']*4
 variants=[]
 for suffix,label in [('nearest','PhotoSuite nearest'),('bilinear','PhotoSuite bilinear'),('sharper','PhotoSuite sharper'),('alpha','Real-ESRGAN x4v3')]:
  im=Image.frombytes('RGBA',(w,h),(base/(c['id']+'-'+suffix+'.bin')).read_bytes())
  im.save(out/(c['id']+'-'+suffix+'.png'))
  # Central actual-resolution crop and whole-output overview, both against checkerboard.
  cx,cy={'text':(120*4,55*4),'ui':(55*4,65*4),'portrait':(115*4,70*4),'transparent':(45*4,50*4),'limit':(480*4,256*4)}.get(c['id'],(w//2,h//2))
  crop=im.crop((max(0,cx-160),max(0,cy-128),min(w,cx+160),min(h,cy+128)))
  thumb=im.copy();thumb.thumbnail((320,240))
  panel=Image.new('RGB',(340,550),'#25292d');d=ImageDraw.Draw(panel);d.text((10,8),label,fill='white')
  for y in range(32,548,16):
   for x in range(10,330,16):d.rectangle((x,y,x+15,y+15),fill='#aaa' if (x//16+y//16)%2 else '#ddd')
  panel.paste(thumb,(10,32),thumb);panel.paste(crop,(10,286),crop);variants.append(panel)
 sheet=Image.new('RGB',(1360,582),'#25292d');d=ImageDraw.Draw(sheet);d.text((10,8),f"{c['id']}: {c['width']}x{c['height']} -> {w}x{h}; top overview / bottom 1:1 selected crop",fill='white')
 for i,p in enumerate(variants):sheet.paste(p,(i*340,32))
 sheet.save(out/(c['id']+'-comparison.jpg'),quality=90)
