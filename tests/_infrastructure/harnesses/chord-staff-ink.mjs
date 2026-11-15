// Independent browser ink oracle. Does not start the household controller.
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

export async function inspectStaffSvg(host, air=2, {keySignature='C',expectedColumns=null,referenceAccidentals=[]}={}) {
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
  const owners={treble:[],bass:[]};
  for(const g of svg.querySelectorAll('[data-staff]'))if(owners[g.dataset.staff])owners[g.dataset.staff].push(g.getBBox());
  const potential=owners.treble.some(a=>owners.bass.some(b=>a.x<b.x+b.width+air&&b.x<a.x+a.width+air&&a.y<b.y+b.height+air&&b.y<a.y+a.height+air));
  const empty={pixels:new Uint8ClampedArray(0),width:1,count:0};
  const t=potential?await mask('treble'):empty,b=potential?await mask('bass'):empty;
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
  // Reconstruct SOUNDING pitch from drawn note positions, accidental outlines and
  // visible octave indications. Do not read a copied MIDI/epoch/octave data value.
  const pitchFailures=[];
  if(expectedColumns) {
    const lineYs=[...new Set([...svg.querySelectorAll('path')].map(p=>p.getBBox()).filter(b=>b.width>100&&b.height<0.1).map(b=>Math.round(b.y*100)/100))].sort((a,b)=>a-b);
    const steps=[0,2,4,5,7,9,11],letters=['C','D','E','F','G','A','B'];
    const sharpKeys=['C','G','D','A','E','B','F#','C#'],flatKeys=['C','F','Bb','Eb','Ab','Db','Gb','Cb'];
    const keyAlters={};
    if(sharpKeys.includes(keySignature))for(const l of ['F','C','G','D','A','E','B'].slice(0,sharpKeys.indexOf(keySignature)))keyAlters[l]=1;
    if(flatKeys.includes(keySignature))for(const l of ['B','E','A','D','G','C','F'].slice(0,flatKeys.indexOf(keySignature)))keyAlters[l]=-1;
    const signature=path=>{
      const n=(path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
      return n.map((v,i)=>v-(i%2?n[1]:n[0]));
    };
    const accidental=path=>{
      const numbers=signature(path);
      return referenceAccidentals.find(r=>r.shape.length===numbers.length&&r.shape.every((v,i)=>Math.abs(v-numbers[i])<0.04))?.alter;
    };
    const groups=[...svg.querySelectorAll('g.vf-stavenote[data-staff]')];
    const count=Math.max(-1,...groups.map(g=>Number(g.dataset.column)))+1;
    const expected=expectedColumns.filter(c=>(Array.isArray(c)?c:c.midis)?.length).slice(-count);
    const sounding=Array.from({length:count},()=>[]);
    for(const group of groups) {
      const staff=group.dataset.staff,column=Number(group.dataset.column);
      const bottom=staff==='treble'?lineYs[4]:lineYs[9];
      if(bottom===undefined){pitchFailures.push('missing staff lines');continue;}
      const spacing=lineYs[1]-lineYs[0];
      const x=group.querySelector('.vf-notehead > path')?.getBBox().x??0;
      const clefs=[...svg.querySelectorAll(`.vf-clef[data-staff="${staff}"]`)].filter(g=>g.getBBox().x<=x).sort((a,b)=>a.getBBox().x-b.getBBox().x);
      const badge=clefs.at(-1)?.querySelector('.staff-clef-octave');
      const clefOctave=badge ? (Number(badge.getAttribute('y'))<bottom-2*spacing?1:-1)*(badge.textContent==='15'?2:1) : 0;
      const residual=[...group.querySelectorAll('text')].find(t=>/^(8v|(?:15|22|29)m)[ab]$/.test(t.textContent));
      const localOctave=residual?(residual.textContent.endsWith('a')?1:-1)*Math.round((parseInt(residual.textContent,10)-1)/7):0;
      for(const head of group.querySelectorAll('.vf-notehead')) {
        const paths=[...head.querySelectorAll(':scope > path')];
        if(!paths.length)continue;
        const b=paths[0].getBBox(),y=b.y+b.height/2;
        const diatonic=(staff==='treble'?30:18)+Math.round((bottom-y)/(spacing/2));
        const degree=((diatonic%7)+7)%7;
        const modifier=paths.slice(1).map(accidental).find(a=>a!==undefined);
        const alter=modifier??keyAlters[letters[degree]]??0;
        sounding[column].push((Math.floor(diatonic/7)+1)*12+steps[degree]+alter+12*(clefOctave+localOctave));
      }
    }
    for(let i=0;i<count;i++) {
      const raw=expected[i];const want=[...(Array.isArray(raw)?raw:raw?.midis??[])].sort((a,b)=>a-b),actual=sounding[i].sort((a,b)=>a-b);
      if(JSON.stringify(want)!==JSON.stringify(actual))pitchFailures.push({column:i,want,actual});
    }
  }
  const headPositions=[...svg.querySelectorAll('g.vf-stavenote[data-staff]')].map(g=>({
    id:Number(g.dataset.columnId),staff:g.dataset.staff,
    xs:[...g.querySelectorAll('.vf-notehead > path:first-child')].map(p=>p.getBBox().x)
  }));
  return {headPositions,crossStaffInkHits:hits,pitchFailures,clipped,bounds:{ink:{x:bb.x,y:bb.y,width:bb.width,height:bb.height},frame:[vx,vy,vw,vh],outside:[...svg.querySelectorAll('path,text')].map(p=>({b:p.getBBox(),p})).filter(({b})=>b.y<vy||b.y+b.height>vy+vh||b.x<vx||b.x+b.width>vx+vw).slice(0,6).map(({b,p})=>({column:p.closest('[data-column]')?.getAttribute('data-column'),staff:p.closest('[data-staff]')?.getAttribute('data-staff'),text:p.textContent,y:b.y,height:b.height}))},minimumColumnAir:Number.isFinite(minimumColumnAir)?minimumColumnAir:null,elementCount:t.count+b.count};
}

export async function openStaffInkHarness() {
  const dir=await mkdtemp(join(tmpdir(),'staff-ink-'));
  await build({stdin:{contents:`import {renderChordStaff} from ${JSON.stringify(join(repo,'__capabilities/music-notation/browser/renderers/chordStaff.js'))};window.renderChordStaff=renderChordStaff;`,resolveDir:repo},bundle:true,format:'iife',define:{'import.meta.env':JSON.stringify({MODE:'test',VITE_BUILD_ID:'staff-render-check'})},outfile:join(dir,'bundle.js'),nodePaths:[join(repo,'frontend/node_modules')],logLevel:'warning'});
  await writeFile(join(dir,'index.html'),'<!doctype html><html><body style="margin:0;background:white"><div id="staff" style="width:1120px;height:420px;position:relative"></div><script src="bundle.js"></script></body></html>');
  let browser;
  try {browser=await chromium.launch();} catch(e) {await rm(dir,{recursive:true,force:true});throw e;}
  const page=await browser.newPage({viewport:{width:1120,height:450}});
  await page.goto('file://'+join(dir,'index.html'));
  await page.addScriptTag({content:`window.inspectStaffSvg=${inspectStaffSvg.toString()}`});
  await page.evaluate(()=>{
    const host=document.querySelector('#staff');
    window.staffAccidentalRefs=[];
    for(const [midi,keySignature,alter] of [[61,'C',1],[70,'C',-1],[65,'G',0]]) {
      window.renderChordStaff(host,{columns:[[midi]],keySignature,aspect:560/210});
      const paths=[...host.querySelectorAll('.vf-notehead > path')];
      const p=paths[1];
      if(!p)throw new Error('Missing accidental characterization glyph');
      const n=(p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g)??[]).map(Number);
      window.staffAccidentalRefs.push({alter,shape:n.map((v,i)=>v-(i%2?n[1]:n[0]))});
    }
  });
  return {
    page,
    async measureCase(opts) {
      return page.evaluate(async opts=>{
        const host=document.querySelector('#staff');
        if(opts.columns)opts.columns=opts.columns.map(c=>Array.isArray(c)?c:{...c,spelling:Array.isArray(c.spelling)?new Map(c.spelling):c.spelling});
        window.renderChordStaff(host,{aspect:560/210,...opts});
        if(opts.corruptClefSign) {
          const badge=host.querySelector('.staff-clef-octave');
          if(!badge)throw new Error('Clef sign control requires an octave badge');
          badge.setAttribute('y','75');
        }
        if(opts.dropFirstHead)host.querySelector('.vf-notehead > path')?.remove();
        if(opts.positiveControl) {
          const svg=host.querySelector('svg');
          for(const staff of ['treble','bass']) {const g=document.createElementNS(svg.namespaceURI,'g');g.dataset.staff=staff;const r=document.createElementNS(svg.namespaceURI,'rect');for(const [k,v] of Object.entries({x:100,y:100,width:20,height:20,fill:'black'}))r.setAttribute(k,v);g.appendChild(r);svg.appendChild(g);}
        }
        return window.inspectStaffSvg(host,opts.air??2,{keySignature:opts.keySignature??'C',expectedColumns:opts.columns,referenceAccidentals:window.staffAccidentalRefs});
      },opts);
    },
    async close(){await browser.close();await rm(dir,{recursive:true,force:true});}
  };
}
