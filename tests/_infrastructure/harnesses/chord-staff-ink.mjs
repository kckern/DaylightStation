// Independent browser ink oracle. Does not start the household controller.
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

export async function inspectStaffSvg(host, air=2) {
  const svg=host.querySelector('svg');
  const [vx,vy,vw,vh]=svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  const bb=svg.getBBox();
  const clipped=bb.x<vx || bb.y<vy || bb.x+bb.width>vx+vw || bb.y+bb.height>vy+vh;
  const mask=async(staff)=>{
    const copy=document.createElementNS('http://www.w3.org/2000/svg','svg');
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
    copy.setAttribute('viewBox',`${vx} ${vy} ${vw} ${vh}`);
    copy.setAttribute('width',Math.ceil(vw*2)); copy.setAttribute('height',Math.ceil(vh*2));
    const inverse=svg.getCTM().inverse();
    let count=0;
    for(const el of svg.querySelectorAll(`[data-staff="${staff}"] path,[data-staff="${staff}"] text,[data-staff="${staff}"] rect`)) {
      const clone=el.cloneNode(true); const matrix=inverse.multiply(el.getCTM());
      clone.setAttribute('transform',`matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f})`);
      const style=getComputedStyle(el);
      for(const property of ['fill','stroke','stroke-width','font-family','font-size','font-weight','font-style']) clone.style.setProperty(property,style.getPropertyValue(property));
      copy.appendChild(clone); count++;
    }
    const canvas=document.createElement('canvas'); canvas.width=Math.ceil(vw*2); canvas.height=Math.ceil(vh*2);
    const ctx=canvas.getContext('2d');
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
    try {
      const img=new Image(); img.src=url; await img.decode(); ctx.drawImage(img,0,0);
      return {pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,count};
    } finally {URL.revokeObjectURL(url);}
  };
  const t=await mask('treble'),b=await mask('bass');
  const hits=[]; const radius=Math.ceil(air*2); const h=t.pixels.length/4/t.width;
  for(let y=radius;y<h-radius && hits.length<10;y++) for(let x=radius;x<t.width-radius && hits.length<10;x++) {
    if(t.pixels[(y*t.width+x)*4+3]<128) continue;
    let found=false;
    for(let dy=-radius;dy<=radius && !found;dy++) for(let dx=-radius;dx<=radius;dx++) {
      if(dx*dx+dy*dy>radius*radius) continue;
      if(b.pixels[((y+dy)*t.width+x+dx)*4+3]>=128) {hits.push({x:vx+x/2,y:vy+y/2}); found=true; break;}
    }
  }
  const boxes={treble:[],bass:[]};
  for(const g of svg.querySelectorAll('g.vf-stavenote[data-staff]')) {const q=g.getBBox();boxes[g.dataset.staff].push([q.x,q.x+q.width]);}
  let minimumColumnAir=Infinity;
  for(const list of Object.values(boxes)) {list.sort((a,b)=>a[0]-b[0]);for(let i=1;i<list.length;i++)minimumColumnAir=Math.min(minimumColumnAir,list[i][0]-list[i-1][1]);}
  return {crossStaffInkHits:hits,clipped,minimumColumnAir:Number.isFinite(minimumColumnAir)?minimumColumnAir:null,elementCount:t.count+b.count};
}

export async function openStaffInkHarness() {
  const dir=await mkdtemp(join(tmpdir(),'staff-ink-'));
  await build({stdin:{contents:`import {renderChordStaff} from ${JSON.stringify(join(repo,'__capabilities/music-notation/browser/renderers/chordStaff.js'))};window.renderChordStaff=renderChordStaff;`,resolveDir:repo},bundle:true,format:'iife',outfile:join(dir,'bundle.js'),nodePaths:[join(repo,'frontend/node_modules')],logLevel:'warning'});
  await writeFile(join(dir,'index.html'),'<!doctype html><html><body style="margin:0;background:white"><div id="staff" style="width:1120px;height:420px;position:relative"></div><script src="bundle.js"></script></body></html>');
  let browser;
  try {browser=await chromium.launch();} catch(e) {await rm(dir,{recursive:true,force:true});throw e;}
  const page=await browser.newPage({viewport:{width:1120,height:450}});
  await page.goto('file://'+join(dir,'index.html'));
  await page.addScriptTag({content:`window.inspectStaffSvg=${inspectStaffSvg.toString()}`});
  return {
    page,
    async measureCase(opts) {
      return page.evaluate(async opts=>{
        const host=document.querySelector('#staff');
        window.renderChordStaff(host,{aspect:560/210,...opts});
        if(opts.positiveControl) {
          const svg=host.querySelector('svg');
          for(const staff of ['treble','bass']) {const g=document.createElementNS(svg.namespaceURI,'g');g.dataset.staff=staff;const r=document.createElementNS(svg.namespaceURI,'rect');for(const [k,v] of Object.entries({x:100,y:100,width:20,height:20,fill:'black'}))r.setAttribute(k,v);g.appendChild(r);svg.appendChild(g);}
        }
        return window.inspectStaffSvg(host,opts.air??2);
      },opts);
    },
    async close(){await browser.close();await rm(dir,{recursive:true,force:true});}
  };
}
