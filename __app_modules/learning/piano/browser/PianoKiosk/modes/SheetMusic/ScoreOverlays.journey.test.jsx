// Real ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun, engraved by OSMD in Chromium.
// What is drawn on or around the engraving (passage numbers, the passage box, the live ink,
// the count-in band) is either shown whole or not at all: no ancestor's overflow and no page
// cut slices it, and nothing of it stands on the music. The score climbs to C7 in its first
// system and drops to C1 in its last, with phrase marks where passage numbers stand.
// Only hardware, roster/config, logging, and HTTP are replaced (as in LearnCoach.journey).
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pianoCoachFixture } from '../../../../../../../tests/_lib/pianoCoachFixture.mjs';
import { validateAssessment } from '../../../../portable/music/assessmentRecord.mjs';
import { PianoLearnCoachService } from '../../../../server/application/PianoLearnCoachService.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const ARTIFACTS = path.join(ROOT, '.superpowers/sdd/2026-11-23-score-overlay-clip/browser');
const SCORE_ID = 'files:overlay-clip.musicxml';
const N = 24;
const ATTR = '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>';
const note = (step, octave, staff, slur = '') => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff>${slur ? `<notations><slur number="1" type="${slur}" placement="above"/></notations>` : ''}</note>`;
// A phrase mark over the opening bars of each passage (5, 9, ...): ink over the staff where its number stands.
const slurAt = (m, i) => (m > 1 && (m - 1) % 4 === 0 ? (i === 0 ? 'start' : i === 3 ? 'stop' : '') : '');
// The first bar climbs to C7 (ledger lines over the treble); the last bar drops to C1 (ledger lines under the bass).
const rh = (m) => m === 1 ? [['C',5],['G',5],['E',6],['C',7]] : m === 2 ? [['D',7],['B',6],['C',7],['A',6]] : [['C',4],['D',4],['E',4],['F',4]];
const lh = (m) => m === N ? [['C',3],['G',2],['E',2],['C',1]] : [['C',3],['D',3],['E',3],['F',3]];
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: N }, (_, i) => i + 1).map((m) => `<measure number="${m}">${m === 1 ? ATTR : ''}${rh(m).map(([s, o], i) => note(s, o, 1, slurAt(m, i))).join('')}<backup><duration>4</duration></backup>${lh(m).map(([s, o]) => note(s, o, 2)).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 // The ceremony curtain reads the game registry only for the game gate; its lazy games are not part of Learn.
 [/browser\/gameRegistry\.js$/, `export const getGameEntry=()=>null;`],
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learn:{ skipping:{ default:'open' }, certification:{ testOutFirst:false } } } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
 [/PianoKiosk\/PianoUserContext\.jsx$/, `import {useSyncExternalStore} from 'react'; let user='learner4'; const subs=new Set(); const sub=f=>{subs.add(f);return()=>subs.delete(f)}; window.__profile=id=>{user=id;for(const f of subs)f()}; export const usePianoUser=()=>({currentUser:useSyncExternalStore(sub,()=>user,()=>user)});`],
 [/PianoKiosk\/PianoMidiContext\.jsx$/, `import {useSyncExternalStore} from 'react'; import {flushSync} from 'react-dom'; let notes=new Map();const subs=new Set(),events=new Set();const sub=f=>{subs.add(f);return()=>subs.delete(f)}; const midi={connected:true,subscribe:f=>{events.add(f);return()=>events.delete(f)},subscribeRaw:()=>()=>{},pressNote:()=>{},releaseNote:()=>{},sendNoteAt:(note)=>{(window.__audio??=[]).push(note)},sendNoteOffAt:()=>{},sendPanic:()=>{}}; window.__hold=midis=>{const now=Date.now();const before=notes;flushSync(()=>{notes=new Map(midis.map(m=>[m,before.get(m)??{timestamp:now,velocity:80}]));for(const f of subs)f();});for(const midi of midis) if(!before.has(midi))for(const f of events)f({type:'note_on',note:midi,velocity:80,timeStamp:performance.now()});};export const usePianoMidi=()=>midi;export const usePianoMidiNotes=()=>({activeNotes:useSyncExternalStore(sub,()=>notes,()=>notes),noteHistory:[],sustainPedal:false});`],
 [/PianoKiosk\/PianoBreadcrumbContext\.jsx$/, `export const usePianoBreadcrumb=()=>{};`],
 [/PianoKiosk\/usePianoPlayback\.js$/, `export const usePianoPlayback=()=>({setPlaying:()=>{}});`],
 [/PianoKiosk\/useReloadGuard\.js$/, `export default ()=>{};`],
 [/SheetMusic\/useMetronomeClick\.js$/, `export const useMetronomeClick=()=>{}; export default useMetronomeClick;`],
 [/lib\/api\.mjs$/, `export const DaylightAPI=(url,body={},method='GET')=>window.__request({url,body,method});export const DaylightAPIText=async()=>window.__xml;export const DaylightMediaPath=p=>p;export const DaylightImagePath=p=>p;export const ContentDisplayUrl=p=>p;export const DaylightHostPath=()=>'';export const DaylightStatusCheck=async()=>({});export const DaylightWebsocketSubscribe=()=>{};export const DaylightWebsocketUnsubscribe=()=>{};export const normalizeImageUrl=u=>u;`],
];
let browser, js, css;
beforeAll(async () => {
 const sheets = new Set(); const esbuild = require('esbuild');
 const bundle = await esbuild.build({ stdin:{ contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import ScorePlayer from './ScorePlayer.jsx';window.__mount=()=>{window.__root?.unmount();window.__root=createRoot(document.getElementById('root'));window.__root.render(<MemoryRouter><ScorePlayer score={{id:${JSON.stringify(SCORE_ID)},title:'Coach journey',musicXml:window.__xml}}/></MemoryRouter>);};window.__mount();`, resolveDir: HERE, loader:'jsx' }, bundle:true,write:false,format:'iife',nodePaths:[path.resolve(HERE,'../../../../../../../frontend/node_modules')],jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"MODE":"production","DEV":false,"PROD":true}'},logLevel:'silent', plugins:[{name:'io-only',setup(build){
  build.onResolve({filter:/\.(scss|css)$/},args=>{ const file=args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):require.resolve(args.path);sheets.add(file);return{path:file,namespace:'sheet'};});
  build.onLoad({filter:/.*/,namespace:'sheet'},()=>({contents:'',loader:'js'}));
  build.onLoad({filter:/\.(jsx|js|mjs)$/},args=>{for(const [pattern,contents] of stubs)if(pattern.test(args.path))return{contents,loader:'jsx'};
    if(args.path.endsWith('/ui/icons/Icon.jsx')){const dir=path.join(path.dirname(args.path),'svg');const files=[...fs.readdirSync(dir).filter(f=>f.endsWith('.svg')),...fs.readdirSync(path.join(dir,'generated')).filter(f=>f.endsWith('.svg')).map(f=>`generated/${f}`)];const assets=Object.fromEntries(files.map(f=>[`./svg/${f}`,fs.readFileSync(path.join(dir,f),'utf8')]));return{contents:fs.readFileSync(args.path,'utf8').replace(/import\.meta\.glob\([^\n]+\)/,JSON.stringify(assets)),loader:'jsx'};}return null;});
 }}] });js=bundle.outputFiles[0].text;
 const sass = await import('sass-embedded'); const out=[];
 for(const file of new Set([path.join(ROOT,'__capabilities/music-notation/browser/styles/tokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/pianoTokens.scss'),path.join(ROOT,'__app_modules/learning/piano/browser/PianoApp.scss'),...sheets]))out.push(file.endsWith('.css')?fs.readFileSync(file,'utf8'):(await sass.compileAsync(file,{loadPaths:[path.join(ROOT,'frontend'),path.dirname(file)]})).css);
 css=out.join('\n').replace(/@font-face\s*\{[^}]*\}/g,'');
 const {chromium}=await import('playwright');browser=await chromium.launch();fs.mkdirSync(ARTIFACTS,{recursive:true});
},180000);
afterAll(async()=>{await browser?.close();});
async function open(viewport={width:1280,height:800}){
 const f=pianoCoachFixture(); f.pieceNotes=[]; const service=new PianoLearnCoachService({...f,skipping:SKIPPING,pieceLog:{note:(entry)=>{f.pieceNotes.push(entry);return entry;}}});const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__request',async({url,body,method})=>{
  const [,user]=url.match(/users\/([^/]+)/)??[];
  if(f.offline && method==='POST')throw new Error('offline');
  if(url.includes('/preferences'))return{};
  if(url.includes('/attempts')){const checked=validateAssessment(body);if(!checked.valid)throw new Error(checked.errors.join('; '));f.attempts.set(body.attempt_id,{...body,user_id:user});return{attempt_id:body.attempt_id};}
  const [,key]=url.match(/practice\/([^/?]+)/)??[];
  if(url.includes('/coach'))return method==='POST'?service.record(user,key,body):service.get(user,key);
  if(key)return f.datastore.getPractice(user,key);return{};
 });
 await page.route('http://learn.test/**',route=>route.fulfill({status:200,body:'<!doctype html>'}));await page.goto('http://learn.test');
 await page.setContent(`<style>${css}html,body{margin:0}#root{height:calc(100vh - 70px);display:flex;flex-direction:column;min-height:0}</style><div class="piano-app"><header style="height:70px"></header><div id="root"></div></div>`);
 await page.evaluate(value=>{window.__xml=value},xml);await page.addScriptTag({content:js});
 return{page,f,errors};
}
// These journeys walk the ladder from its first step, so test-out-first is off here (it is covered in the coach unit tests).
// They go straight to score tempo, which the default skipping mode holds behind Silver; kiosk and server agree on `open`.
const SKIPPING={ default:'open' };
const click=async(page,name)=>{await page.getByRole('button',{name,exact:true}).click({timeout:30000});};
const armed=async(page)=>{await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);};
// Open the passage (the rail button), then tap a set of the drill to run that step.
const openPassage=async(page)=>{await click(page,'Practice bars 1–2');await armed(page);};
const openStep=async(page,step)=>{await openPassage(page);await page.locator('button.drill-cluster').and(page.getByRole('button',{name:STEP_NAMES[step],exact:true})).click();await page.locator('.piano-learn-lab__task').filter({hasText:STEP_NAMES[step]}).waitFor();await armed(page);};
const STEP_NAMES={'On your own':'Play it on your own','100%':'Play at score tempo','Rhythm':'Tap the rhythm'};
const card=(page,text)=>page.locator('.rep-card').filter({hasText:text});
// Silver and Gold close the drill's curtain; its verdict carries the word.
const curtain=(page,word)=>page.locator('.gate-ceremony').filter({has:page.locator('.gate-ceremony__word',{hasText:word})});
// A timed take counts in on any key, then expects eight beats at 240 BPM.
async function playTimed(page){
 const before=await page.evaluate(()=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length);
 await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});
 await page.waitForFunction((n)=>window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').length>n,before);
 await page.evaluate(async()=>{const log=window.__logs.filter(l=>l.event==='piano.exercise-countdown-started').at(-1);const downbeat=log.at+log.data.countdownRemainingMs;for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,Math.max(0,downbeat+i*250-Date.now())));window.__hold([[60,48],[62,50],[64,52],[65,53]][i%4]);await new Promise(r=>setTimeout(r,75));window.__hold([]);}});
}

// Every element matched: visible whole, or not at all. Any ancestor (the SVG itself included) whose
// overflow clips, or whose clip-path is the page cut, must not slice it. `ring` grows the box by a halo drawn outside it.
async function partlyClipped(page,selector,ring=0){
 return page.evaluate(({selector,ring})=>{
  const out=[];
  const clipOf=(el)=>{const cs=getComputedStyle(el);const r=el.getBoundingClientRect();const boxes=[];
   if(cs.overflowX!=='visible'||cs.overflowY!=='visible')boxes.push({top:r.top,bottom:r.bottom,left:r.left,right:r.right});
   if(cs.clipPath&&cs.clipPath!=='none'&&el.classList.contains('musicxml-renderer')){const host=el.parentElement;const top=parseFloat(host.style.getPropertyValue('--page-top'));const bottom=parseFloat(host.style.getPropertyValue('--page-bottom'));if(Number.isFinite(top)&&Number.isFinite(bottom))boxes.push({top:r.top+top,bottom:r.top+bottom,left:-1e9,right:1e9});}
   return boxes;};
  const name=(el)=>String((el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className)||el.tagName);
  for(const el of document.querySelectorAll(selector)){
   const b=el.getBoundingClientRect();if(!b.width&&!b.height)continue;
   const box={top:b.top-ring,bottom:b.bottom+ring,left:b.left-ring,right:b.right+ring};
   let visible=true,cut=null;
   for(let a=el.parentElement;a&&a!==document.documentElement;a=a.parentElement){for(const c of clipOf(a)){
    const inside=box.top>=c.top-0.5&&box.bottom<=c.bottom+0.5&&box.left>=c.left-0.5&&box.right<=c.right+0.5;
    const outside=box.bottom<=c.top||box.top>=c.bottom||box.right<=c.left||box.left>=c.right;
    if(outside){visible=false;}else if(!inside&&!cut)cut={by:name(a),clip:c,box};}}
   if(visible&&cut)out.push({el:name(el),text:(el.textContent||'').slice(0,12),...cut});
  }
  return out;},{selector,ring});
}
// Passage numbers that sit on engraved ink (visible ink only: what the page cut leaves on screen).
async function numbersOnInk(page,sel='.piano-learn-passage-map',scope=''){
 return page.evaluate(({sel,scope})=>{
  const r=document.querySelector(scope+'.musicxml-renderer');const host=r.parentElement;const rr=r.getBoundingClientRect();
  const top=rr.top+parseFloat(host.style.getPropertyValue('--page-top')||'-1e9');const bottom=rr.top+parseFloat(host.style.getPropertyValue('--page-bottom')||'1e9');
  const ink=[...document.querySelectorAll(scope+'.musicxml-renderer__svg svg *:not(:has(*))')].map(el=>el.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0&&b.top>=top&&b.bottom<=bottom);
  const out=[];
  for(const el of document.querySelectorAll(sel)){const b=el.getBoundingClientRect();if(b.bottom<=top||b.top>=bottom)continue;
   const hit=ink.filter(i=>i.left<b.right+5&&i.right>b.left-5&&i.top<b.bottom+5&&i.bottom>b.top-5&&!(i.width>300));
   if(hit.length)out.push({text:el.textContent,disc:[b.top,b.bottom,b.left,b.right],ink:hit.slice(0,3).map(i=>[i.top,i.bottom,i.left,i.right])});}
  return out;},{sel,scope});
}
const INK='.musicxml-renderer__svg svg *:not(:has(*))';
// The Learn path's row: every token's disc with its selection ring, its play disc and its bars caption sit inside the
// row, and no caption runs under a disc or its ring (the owner's 2026-11-23 shot: the larger next "C" over "bars 9–12").
async function pathOverlaps(page){
 return page.evaluate(()=>{const nav=document.querySelector('.piano-passage-path').getBoundingClientRect();const out=[];
  const inside=(b)=>b.top>=nav.top-0.5&&b.bottom<=nav.bottom+0.5&&b.left>=nav.left-0.5&&b.right<=nav.right+0.5;
  const meet=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
  const discs=[...document.querySelectorAll('.piano-passage-path__disc')].map(el=>{const b=el.getBoundingClientRect();const cs=getComputedStyle(el);
   const ring=cs.outlineStyle==='none'?0:parseFloat(cs.outlineWidth)+parseFloat(cs.outlineOffset);return{text:el.textContent,box:{top:b.top-ring,bottom:b.bottom+ring,left:b.left-ring,right:b.right+ring}};});
  for(const d of discs)if(!inside(d.box))out.push(`disc ${d.text} or its ring leaves the row`);
  for(const el of document.querySelectorAll('.piano-passage-path__play'))if(!inside(el.getBoundingClientRect()))out.push('play disc leaves the row');
  for(const el of document.querySelectorAll('.piano-passage-path__bars')){if(!el.textContent)continue;const b=el.getBoundingClientRect();
   if(!inside(b))out.push(`caption ${el.textContent} leaves the row`);
   for(const d of discs)if(meet(b,d.box))out.push(`caption ${el.textContent} under disc ${d.text}`);}
  const ladder=document.querySelector('.piano-passage-path .piano-level-ladder');if(ladder&&!inside(ladder.getBoundingClientRect()))out.push('ladder leaves the row');
  for(const el of document.querySelectorAll('.piano-passage-path .piano-level-ladder__rungs li[data-state="current"]')){const b=el.getBoundingClientRect();if(!inside({top:b.top-5,bottom:b.bottom+5,left:b.left-5,right:b.right+5}))out.push('ladder ring leaves the row');}
  return out;});
}
// The Gold lap's steps are drawn only once a passage is Bronze (laps, 2026-11-23 night). A clean hints-off take of the
// passage's four bars earns it: each position right hand, both, left hand, all up.
const PITCH={C:0,D:2,E:4,F:5,G:7,A:9,B:11};const midiOf=([step,octave])=>12*(octave+1)+PITCH[step];
const cleanFrames=(first)=>Array.from({length:4},(_,k)=>first+k).flatMap((m)=>rh(m).map((r,i)=>[midiOf(r),midiOf(lh(m)[i])])).flatMap(([r,l])=>[[r],[r,l],[l],[]]);
describe('the extras drawn on the engraving stay whole',()=>{
 it('Learn score view: passage numbers, the passage box and the ink are never cut by the page or the paper, and no number sits on the music',async()=>{
  const{page,errors}=await open();try{
   await page.locator('.piano-learn-passage-map').first().waitFor({timeout:30000});await page.waitForTimeout(1500);
   await page.screenshot({path:path.join(ARTIFACTS,'learn-score-page1.png')});
   const pages=[];
   const read=async()=>({numbers:await partlyClipped(page,'.piano-learn-passage-map',5),ink:await partlyClipped(page,INK),onInk:await numbersOnInk(page),
    shown:await page.evaluate(()=>{const r=document.querySelector('.musicxml-renderer').getBoundingClientRect();const host=document.querySelector('.piano-score-player__scroll');const top=r.top+parseFloat(host.style.getPropertyValue('--page-top'));const bottom=r.top+parseFloat(host.style.getPropertyValue('--page-bottom'));
     return [...document.querySelectorAll('.piano-learn-passage-map')].filter(b=>{const box=b.getBoundingClientRect();return box.top>=top&&box.bottom<=bottom;}).map(b=>b.textContent);})});
   pages.push(await read());
   // The last system's low C1 and the second page's numbers.
   await page.locator('.piano-score-pager__turn').last().click();await page.waitForTimeout(800);
   await page.screenshot({path:path.join(ARTIFACTS,'learn-score-page2.png')});
   pages.push(await read());
   for(const seen of pages){expect(seen.numbers).toEqual([]);expect(seen.ink).toEqual([]);expect(seen.onInk).toEqual([]);}
   // Every passage number is shown whole on some page.
   expect(new Set(pages.flatMap(seen=>seen.shown))).toEqual(new Set(['A','B','C','D','E','F'])); // the path's letters, on the score too
   // The path's row holds its larger next token, the caption under it and the ladder whole.
   expect(await pathOverlaps(page)).toEqual([]);
   // The last passage chosen on the path: its box holds the low ledger note, its badge ring is whole.
   await page.locator('.piano-passage-path__token').nth(5).click();await page.waitForTimeout(900);
   // A selected token (ringed) beside the larger next one: still whole, captions clear of both.
   expect(await pathOverlaps(page)).toEqual([]);
   await page.screenshot({path:path.join(ARTIFACTS,'learn-score-focus-last.png')});
   expect(await partlyClipped(page,'.piano-learn-selection-box, .piano-learn-selection-outline, .piano-learn-passage-map',5)).toEqual([]);
   const lowNote=await page.evaluate(()=>{const box=document.querySelector('.piano-learn-selection-box').getBoundingClientRect();
    const heads=[...document.querySelectorAll('.musicxml-renderer__svg .vf-notehead')].map(el=>el.getBoundingClientRect()).filter(b=>b.left>=box.left&&b.right<=box.right);
    return {box:box.bottom,lowest:Math.max(...heads.map(b=>b.bottom))};});
   expect(lowNote.lowest).toBeLessThanOrEqual(lowNote.box);
   const scrollers=await page.evaluate(()=>[...document.querySelectorAll('.piano-score-player, .piano-score-player *')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).length);
   expect(scrollers).toBe(0);expect(errors).toEqual([]);
  }finally{await page.close();}
 },120000);
 for(const [name,label,tile] of [['first','Practice bars 1–4',0],['last','Practice bars 21–24',5]]) it(`Learn drill on the ${name} passage: the ink, the overlays and the count-in band stay whole and off the notes`,async()=>{
  const{page,errors}=await open();try{
   // Tap a token to select it (the play disc moves to it), then tap it again to open it.
   await page.locator('.piano-passage-path__token').nth(tile).click({timeout:30000});
   await page.locator('.piano-passage-path__token[data-target]').click({timeout:30000});
   await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(800);
   // The drill screen's path: the open unit is selected (ringed) and, on the first passage, also the larger next token.
   expect(await pathOverlaps(page)).toEqual([]);
   // The step strip is headed by the open unit's own token, and shows only its lap's steps.
   expect(await page.locator('.drill-progress__head').getAttribute('aria-label')).toBe(`${tile ? 'F' : 'A'}, steps to Bronze`);
   expect(await page.locator('button.drill-cluster').count()).toBe(4);
   for(const [step,task] of [['own','Play it on your own'],['timed','Play at score tempo']]){
    if(step==='timed'){
     // Earn the passage's Bronze on its check, come back to it from the path (it opens on the Gold lap), then pick score tempo.
     await page.evaluate(()=>window.__hold([]));await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('button',{name:'Start over',exact:true}).click();await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);
     await page.evaluate(async(list)=>{for(const frame of list){window.__hold(frame);await new Promise(r=>setTimeout(r,70));}},cleanFrames(tile*4+1));
     await page.locator('.gate-ceremony').filter({has:page.locator('.gate-ceremony__word',{hasText:'Bronze!'})}).waitFor({timeout:15000});
     await page.locator('.gate-ceremony').waitFor({state:'detached',timeout:20000});
     await page.locator('.piano-passage-path__token').nth(tile).click({timeout:30000});
     await page.locator('.piano-learn-lab__task').filter({hasText:'Tap the rhythm'}).waitFor({timeout:15000});
     await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);
    }
    await page.locator('button.drill-cluster').and(page.getByRole('button',{name:task,exact:true})).click();await page.locator('.piano-learn-lab__task').filter({hasText:task}).waitFor();
    await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(800);
    // A held chord lights the live ink; on the timed step a key arms the count-in band.
    if(step==='timed'){await page.evaluate(async()=>{window.__hold([72]);await new Promise(r=>setTimeout(r,60));window.__hold([]);});await page.locator('.piano-learn-countin').waitFor();await page.waitForTimeout(300);}
    else await page.evaluate(async()=>{window.__hold([60,48]);await new Promise(r=>setTimeout(r,300));});
    await page.screenshot({path:path.join(ARTIFACTS,`drill-${name}-${step}.png`)});
    if(step==='timed'){expect(await page.locator('.drill-progress__head').getAttribute('aria-label')).toBe(`${tile ? 'F' : 'A'}, steps to Gold`);expect(await pathOverlaps(page)).toEqual([]);}
    expect(await partlyClipped(page,'.piano-exercise-run__stage '+INK)).toEqual([]);
    expect(await partlyClipped(page,'.piano-exercise-run__stage *:not(svg *), .piano-exercise-run__beat')).toEqual([]);
    expect(await numbersOnInk(page,'.piano-learn-countin','.piano-exercise-run__stage ')).toEqual([]);
    await page.evaluate(()=>window.__hold([]));
   }
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },120000);
});
