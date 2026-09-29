import assert from 'node:assert/strict';
import { it } from 'node:test';
import { validateSubjectInput, subjectMapping, prepareSubjectTensor, reconstructSubjectMask, copySubjectResult, SUBJECT_MODEL, SUBJECT_SETTINGS } from '../../../src/features/modernization/subject-workload.js';
function input(width=5,height=3,x=0,y=0) { return { rect:{x,y,width,height}, documentWidth:40,documentHeight:40,rgba:new Uint8Array(width*height*4).fill(255),color:'srgb8',alpha:'straight' }; }
const logits=()=>new Float32Array(512*512);
for(const [w,h] of [[5,3],[3,5],[1,1],[1,7],[17,1],[13,11],[40,40]]) it(`explicit aspect transform roundtrip ${w}x${h}`,()=>{
 const a=input(w,h,7,9),p=prepareSubjectTensor(a),m=p.mapping;
 assert.equal(p.tensor.length,3*512*512);
 assert.ok(m.width<=512&&m.height<=512); assert.ok(m.width===512||m.height===512);
 for(const [x,y] of [[0,0],[w-1,h-1]]) {
  assert.ok(Math.abs(((x+.5)*m.scaleX)/m.scaleX-.5-x)<1e-10);
  assert.ok(Math.abs(((y+.5)*m.scaleY)/m.scaleY-.5-y)<1e-10);
 }
 const r=reconstructSubjectMask(a,m,logits(),[1,1,512,512]);
 assert.equal(r.bytes.length,w*h);assert.deepEqual(r.rect,a.rect);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.equal(r.bytes[y*w+x],x+7<40&&y+9<40?128:0);
});
it('RGBA preprocessing composites before interpolation; transparent RGB garbage is irrelevant',()=>{
 const a=input(2,1),b=input(2,1); a.rgba.set([10,20,30,0,255,80,10,128]);b.rgba.set([255,255,255,0,255,80,10,128]);
 assert.deepEqual(prepareSubjectTensor(a).tensor,prepareSubjectTensor(b).tensor);
 const all=input(1,1);all.rgba.set([255,0,40,0]);const t=prepareSubjectTensor(all).tensor;
 assert.ok(Math.abs(t[0]-(128/255-.485)/.229)<1e-6);
});
it('RGB-only/unsupported layout and assumptions are rejected',()=>{
 for(const edit of [a=>a.rgba=new Uint8Array(15),a=>a.alpha='premultiplied',a=>a.color='linear',a=>a.rect.width=0,a=>a.rect.x=NaN,a=>a.documentWidth=8193,a=>a.documentWidth=8192]){
  const a=input();edit(a);if(a.documentWidth===8192)a.documentHeight=8192;assert.throws(()=>validateSubjectInput(a));
 }
});
it('neutral letterbox padding and ImageNet channel normalization are explicit',()=>{
 const a=input(2,1);a.rgba.fill(255);const {tensor,mapping}=prepareSubjectTensor(a);
 assert.equal(mapping.top,128);assert.equal(mapping.left,0);
 assert.ok(Math.abs(tensor[0]-(128/255-.485)/.229)<1e-6);
 assert.ok(Math.abs(tensor[128*512]-(1-.485)/.229)<1e-6);
});
it('soft reconstruction preserves partial alpha and excludes canvas exterior',()=>{
 const a=input(3,1,-1,0);a.rgba.set([1,2,3,255,4,5,6,128,7,8,9,0]);
 const r=reconstructSubjectMask(a,subjectMapping(a.rect),logits(),[1,1,512,512]);
 assert.deepEqual([...r.bytes],[0,64,0]);assert.deepEqual(r.model,SUBJECT_MODEL);assert.deepEqual(r.settings,SUBJECT_SETTINGS);
});
it('projection is bilinear with clamped content edges, not nearest neighbor or padding bleed',()=>{
 const a=input(1024,1);a.documentWidth=1024;const m=subjectMapping(a.rect),v=new Float32Array(512*512).fill(-80);
 for(let y=m.top;y<m.top+m.height;y++)for(let x=256;x<512;x++)v[y*512+x]=80;
 const r=reconstructSubjectMask(a,m,v,[1,1,512,512]);assert.equal(r.bytes[1023],255);
 assert.ok(r.bytes[511]>0&&r.bytes[511]<128);assert.ok(r.bytes[512]>128&&r.bytes[512]<255);
});
it('bad model dimensions, finite values, mapping and byte contracts fail closed',()=>{
 const a=input(),m=subjectMapping(a.rect),v=logits();
 assert.throws(()=>reconstructSubjectMask(a,m,v,[1,512,512]));
 assert.throws(()=>reconstructSubjectMask(a,{...m,left:m.left+1},v,[1,1,512,512]));
 v[37]=NaN;assert.throws(()=>reconstructSubjectMask(a,m,v,[1,1,512,512]));
 const r=reconstructSubjectMask(a,m,logits(),[1,1,512,512]);
 for(const edit of [r=>r.bytes=new Uint8Array(1),r=>r.model={...SUBJECT_MODEL,sha256:'bad'},r=>r.settings={},r=>r.outsideCoverage=255,r=>r.rect.width=8193]){
  const b=copySubjectResult(r);edit(b);assert.throws(()=>copySubjectResult(b));
 }
 const b=copySubjectResult(r);r.bytes.fill(0);assert.equal(b.bytes[0],128);
});
