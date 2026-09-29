#!/usr/bin/env python3
"""Inspect a Tauri PHF embedded asset table from the delivered executable.
Requires lief and brotli (inspection tools only; not application dependencies). Thin universal Mach-O binaries before invoking.
Run from the repository root after staging.
Usage: python scripts/inspect-packaged-frontend.py BINARY INVENTORY_JSON OUTPUT_JSON
"""
import sys,struct,json,hashlib,re
import lief,brotli
from html.parser import HTMLParser
from pathlib import Path
binary,inventory_path,output=sys.argv[1:]
raw_data=open(binary,'rb').read(); data=bytearray(raw_data); obj=lief.parse(binary)
regions=[]
if isinstance(obj,lief.MachO.Binary):
    regions=[(s.virtual_address,s.file_offset,s.file_size) for s in obj.segments if s.file_size]
    arch=str(obj.header.cpu_type)
elif isinstance(obj,lief.ELF.Binary):
    regions=[(s.virtual_address,s.file_offset,s.physical_size) for s in obj.segments if s.type==lief.ELF.Segment.TYPE.LOAD]
    arch=str(obj.header.machine_type)
elif isinstance(obj,lief.PE.Binary):
    regions=[(s.virtual_address+obj.optional_header.imagebase,s.pointerto_raw_data,s.sizeof_raw_data) for s in obj.sections]
    arch=str(obj.header.machine)
else: raise RuntimeError('Unsupported executable')
def offset(va,size=1):
    for start,off,length in regions:
        if start<=va and va+size<=start+length:return off+va-start
    raise ValueError('unmapped address')
# ELF PIE binaries keep pointer addends in RELA rather than in the data slots.
# Apply only relative relocations to this inspection view, never the file.
relocations_applied=0
if isinstance(obj,lief.ELF.Binary):
    for relocation in obj.relocations:
        if str(relocation.type).endswith('_RELATIVE'):
            struct.pack_into('<Q',data,offset(relocation.address,8),relocation.addend)
            relocations_applied+=1

def address(off):
    for start,fo,length in regions:
        if fo<=off<fo+length:return start+off-fo
    raise ValueError('unmapped offset')
def row(pos):
    kp,kl,vp,vl=struct.unpack_from('<QQQQ',data,pos)
    if not (1<kl<500 and 0<vl<len(data)):raise ValueError('invalid lengths')
    ko=offset(kp,kl);vo=offset(vp,vl)
    key=data[ko:ko+kl].decode('utf8')
    if not re.fullmatch(r'/[A-Za-z0-9_./ @+()\-]+',key):raise ValueError('invalid key')
    return key[1:],vo,vl
candidates=[];pos=0
while True:
    pos=data.find(b'/index.html',pos)
    if pos<0:break
    try: needle=struct.pack('<QQ',address(pos),11)
    except ValueError:pos+=1;continue
    rp=0
    while True:
        rp=data.find(needle,rp)
        if rp<0:break
        try:
            key,vo,vl=row(rp)
            decoded=brotli.decompress(data[vo:vo+vl])
            if b'<html' in decoded:candidates.append(rp)
        except (ValueError,UnicodeError,brotli.error):pass
        rp+=1
    pos+=1
if len(candidates)!=1:raise RuntimeError(f'Expected one asset map anchor, found {candidates}')
start=candidates[0]
while start>=32:
    try:row(start-32);start-=32
    except (ValueError,UnicodeError,struct.error):break
records=[];pos=start;html_bytes=None
while True:
    try:key,off,length=row(pos)
    except (ValueError,UnicodeError,struct.error):break
    plain=brotli.decompress(data[off:off+length])
    if key=='index.html':html_bytes=plain
    records.append({'path':key,'bytes':len(plain),'sha256':hashlib.sha256(plain).hexdigest()})
    pos+=32
# Record a PHF slice reference when retained as data by the optimizer.
reference=data.find(struct.pack('<QQ',address(start),len(records)))
# Optimizers may materialize the slice address in instructions instead of data.
# Both ends were bounded by decoding the contiguous 32-byte PHF entry array.
# Compare the transformed HTML's runtime links and original inline scripts.
class HTMLRoots(HTMLParser):
    def __init__(self):
        super().__init__();self.links=[];self.scripts=[];self.inline=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        for key in ('src','href'):
            if key in attrs:self.links.append((tag,key,attrs[key]))
        if tag=='script' and 'src' not in attrs:self.inline=True;self.scripts.append('')
    def handle_data(self,data):
        if self.inline:self.scripts[-1]+=data
    def handle_endtag(self,tag):
        if tag=='script':self.inline=False
expected_html=HTMLRoots();actual_html=HTMLRoots()
expected_html.feed(Path('dist/index.html').read_text());actual_html.feed(html_bytes.decode('utf8'))
if expected_html.links!=actual_html.links:raise RuntimeError('Packaged HTML runtime links differ')
for inline in expected_html.scripts:
    if inline.strip() not in [s.strip() for s in actual_html.scripts]:raise RuntimeError('Packaged HTML inline script differs')
expected={r['path']:r for r in json.load(open(inventory_path))}
actual={r['path']:r for r in records}
if len(actual)!=len(records):raise RuntimeError('Duplicate asset keys')
missing=sorted(expected.keys()-actual.keys());extra=sorted(actual.keys()-expected.keys())
changed=[k for k in expected.keys() & actual.keys() if k!='index.html' and expected[k]!=actual[k]]
result={'binary':binary,'architecture':arch,'binary_bytes':len(data),'binary_sha256':hashlib.sha256(raw_data).hexdigest(),'relocations_applied':relocations_applied,'asset_count':len(records),'table_offset':start,'table_reference_offset':reference,'missing':missing,'extra':extra,'changed':changed,'index_html':'Decoded; all runtime links and original inline scripts match staged HTML','assets':sorted(records,key=lambda r:r['path'])}
json.dump(result,open(output,'w'),indent=2)
print(json.dumps({k:v for k,v in result.items() if k!='assets'},indent=2))
if missing or extra or changed:sys.exit(1)
