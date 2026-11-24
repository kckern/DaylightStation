// Real ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun, engraved by OSMD in Chromium, on the owner's
// 2026-11-24 office shot (Santa Claus, bars 21–24, "Play it on your own"): an eighth tied to a quarter in
// both hands, a pickup bar printed 0, and an 8va over the passage's last bar.
//  1. The tied quarter is the eighth held on: never a separate note to strike (the cursor goes from the
//     eighth to the next bar), painted with the eighth's verdict, and a re-strike of it is not wrong.
//  2. The tricky-bar sentence names the bar printed on the page, not its index + 1.
//  3. The Right/Wrong tally never stands on notation ink (the 8va at the top right).
// Only hardware, roster/config, logging, and HTTP are replaced (as in ScoreOverlays.journey).
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
const ARTIFACTS = path.join(ROOT, '.superpowers/sdd/2026-11-24-learn-ties/browser');
const SCORE_ID = 'files:learn-ties.musicxml';
const ATTR = '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>';
const TYPE = { 1: 'eighth', 2: 'quarter', 4: 'half', 8: 'whole' };
// [step, octave, duration(eighths), {chord, tie}] — a null step is a rest.
const n = ([step, octave, duration, extra = {}], staff) => step == null
  ? `<note><rest/><duration>${duration}</duration><voice>${staff}</voice><type>${TYPE[duration]}</type><staff>${staff}</staff></note>`
  : `<note>${extra.chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra.tie ? `<tie type="${extra.tie}"/>` : ''}<voice>${staff}</voice><type>${TYPE[duration]}</type><staff>${staff}</staff>${extra.tie ? `<notations><tied type="${extra.tie}"/></notations>` : ''}</note>`;
const quarters = (notes) => notes.map(([s, o]) => [s, o, 2]);
const OTTAVA = (type) => `<direction placement="above"><direction-type><octave-shift type="${type}" size="8" number="1"/></direction-type><staff>1</staff></direction>`;
// Bar 0 is a one-beat pickup; bars 1–6 are plain quarters; bar 7 holds the tie, bar 8 the 8va.
const bars = [
 { rh: [['G', 4, 2]], lh: [['G', 3, 2]] },
 ...Array.from({ length: 6 }, () => ({ rh: quarters([['C', 4], ['D', 4], ['E', 4], ['F', 4]]), lh: quarters([['C', 3], ['D', 3], ['E', 3], ['F', 3]]) })),
 { rh: [['C', 4, 4], [null, 0, 1], ['E', 4, 1, { tie: 'start' }], ['E', 4, 2, { tie: 'stop' }]],
   lh: [['C', 3, 4], ['G', 3, 4, { chord: true }], [null, 0, 1], ['F', 3, 1, { tie: 'start' }], ['G', 3, 1, { chord: true, tie: 'start' }], ['F', 3, 2, { tie: 'stop' }], ['G', 3, 2, { chord: true, tie: 'stop' }]] },
 { rh: [['C', 4, 4], 'ottava', ['C', 6, 4], 'ottava-stop'], lh: [['C', 3, 8], ['E', 3, 8, { chord: true }], ['G', 3, 8, { chord: true }]] },
];
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars.map((bar, m) => `<measure number="${m}"${m === 0 ? ' implicit="yes"' : ''}>${m === 0 ? ATTR : ''}${bar.rh.map((x) => x === 'ottava' ? OTTAVA('down') : x === 'ottava-stop' ? OTTAVA('stop') : n(x, 1)).join('')}<backup><duration>${m === 0 ? 2 : 8}</duration></backup>${bar.lh.map((x) => n(x, 2)).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 // The ceremony curtain reads the game registry only for the game gate; its lazy games are not part of Learn.
 [/browser\/gameRegistry\.js$/, `export const getGameEntry=()=>null;`],
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learn:{ skipping:{ default:'open' }, certification:{ testOutFirst:false, silver:{ stallSeconds:5 } } } } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
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
const SKIPPING={ default:'open' };
const PITCH={C:0,D:2,E:4,F:5,G:7,A:9,B:11};const midi=(step,octave)=>12*(octave+1)+PITCH[step];
// One frame per event: both hands down together, then up.
const press=async(page,frames,gap=90)=>page.evaluate(async({frames,gap})=>{for(const frame of frames){window.__hold(frame);await new Promise(r=>setTimeout(r,gap));window.__hold([]);await new Promise(r=>setTimeout(r,gap));}},{frames,gap});
const plainBar=[[midi('C',4),midi('C',3)],[midi('D',4),midi('D',3)],[midi('E',4),midi('E',3)],[midi('F',4),midi('F',3)]];
const INK='.musicxml-renderer__svg svg *:not(:has(*))';

describe('Learn drill: ties, printed bar numbers, and the tally off the music',()=>{
 it('plays bars 5–8 on your own: the tie is held not struck, the tricky bar is printed, the tally stands clear of the 8va',async()=>{
  const{page,errors}=await open();try{
   // The second passage (bars 5–8): select its token, open it, pick "Play it on your own".
   await page.locator('.piano-passage-path__token').nth(1).click({timeout:30000});
   await page.locator('.piano-passage-path__token[data-target]').click({timeout:30000});
   await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);
   await page.locator('button.drill-cluster').and(page.getByRole('button',{name:'Play it on your own',exact:true})).click();
   await page.locator('.piano-learn-lab__heading strong').filter({hasText:'Play it on your own'}).waitFor();
   await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(800);
   // Bars 5 and 6, then bar 7's half notes and its tied eighths (both hands).
   await press(page,[...plainBar,...plainBar,[midi('C',4),midi('C',3),midi('G',3)],[midi('E',4),midi('F',3),midi('G',3)]]);
   // 1. The cursor is on bar 8: the tied quarter is not a stop (8 + 2 events played).
   await page.waitForFunction(()=>document.querySelector(".piano-exercise-run")?.dataset.displayedCursor==="10",null,{timeout:5000});
   // A child re-playing the held quarter (each hand) is not charged a wrong note.
   await press(page,[[midi('E',4)],[midi('F',3),midi('G',3)]]);
   await page.waitForTimeout(300);
   expect(await page.locator('.piano-exercise-run__tally .is-wrong').textContent()).toMatch(/Wrong 0$/);
   expect(await page.locator('.piano-exercise-run').getAttribute('data-displayed-cursor')).toBe('10');
   await page.screenshot({path:path.join(ARTIFACTS,'tie-held.png')});
   // 3. The tally covers no ink: not the 8va, not a note.
   const covered=await page.evaluate((INK)=>{const t=document.querySelector('.piano-exercise-run__tally').getBoundingClientRect();
    return [...document.querySelectorAll('.piano-exercise-run__stage '+INK)].map(el=>({el,b:el.getBoundingClientRect()}))
     .filter(({b})=>b.width>0&&b.height>0&&b.left<t.right&&b.right>t.left&&b.top<t.bottom&&b.bottom>t.top)
     .map(({el,b})=>`${el.tagName} ${(el.textContent||'').slice(0,6)} ${Math.round(b.left)},${Math.round(b.top)}`);},INK);
   expect(covered).toEqual([]);
   // ...and on any score, not just this one: the engraving's own box never reaches under the tally,
   // so no 8va, slur or ledger note can climb into its corner (the office shot's clipped "8va").
   const shared=await page.evaluate(()=>{const t=document.querySelector('.piano-exercise-run__tally').getBoundingClientRect();const p=document.querySelector('.piano-exercise-run__stage .piano-score-passage').getBoundingClientRect();
    return Math.max(0,Math.min(t.bottom,p.bottom)-Math.max(t.top,p.top))*Math.max(0,Math.min(t.right,p.right)-Math.max(t.left,p.left));});
   expect(shared).toBe(0);
   // The 8va is drawn (and so measured above): its text is on the page.
   expect(await page.evaluate(()=>[...document.querySelectorAll('.piano-exercise-run__stage svg text')].some(el=>/8/.test(el.textContent)))).toBe(true);
   // Stop before bar 8: the take stalls out and names its tricky bar.
   await page.locator('.piano-exercise-run__verdict-line').waitFor({timeout:20000});
   await page.screenshot({path:path.join(ARTIFACTS,'tie-result.png')});
   // 2. Bar 8 as printed (a pickup is bar 0, so its index + 1 would say "Bar 9").
   expect(await page.locator('.piano-exercise-run__verdict-line').textContent()).toBe('Bar 8 is the tricky spot');
   // 1. Every head of bars 5–7 is judged — the tied quarters too — and only bar 8 is left unmarked.
   const marks=await page.evaluate(()=>{const groups=[...document.querySelectorAll('.piano-exercise-run__stage .vf-stavenote')];
    return {judged:groups.filter(g=>g.getAttribute('data-verdict')==='hit').length,unmarked:groups.filter(g=>!g.hasAttribute('data-verdict')).length};});
   // Bars 5–6: 16 groups; bar 7: RH half + eighth + tied quarter, LH half + eighth + tied quarter.
   expect(marks.judged).toBe(22);
   // Left unjudged: bar 8, not reached (its RH C4, its 8va C6, the LH triad), and bar 7's two eighth rests.
   expect(marks.unmarked).toBe(5);
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },120000);
});
