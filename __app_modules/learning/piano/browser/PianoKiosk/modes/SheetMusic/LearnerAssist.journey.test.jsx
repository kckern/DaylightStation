// Per-learner assist (`sheetmusic.learners.<id>`) in real Chromium at the kiosk's 1280x800, through the real
// ScorePlayer -> LearnCoach -> LearnLab -> ExerciseRun -> ScorePassage path: the drill keyboard lights the next key
// before any mistake, and a wrong note is drawn on the staff as a translucent notehead at the pitch played.
// Only hardware, roster/config, logging, and HTTP are replaced. Notation is engraved by OSMD.
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
const ARTIFACTS = path.join(ROOT, '.superpowers/2026-11-24-learner-assist');
const SCORE_ID = 'files:first-notes-journey.musicxml';
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${[['C','D'],['E','F']].map((pair, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${pair.map((step) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>`).join('')}</measure>`).join('')}</part></score-partwise>`;
const stubs = [
 // The ceremony curtain reads the game registry only for the game gate; its lazy games are not part of Learn.
 [/browser\/gameRegistry\.js$/, `export const getGameEntry=()=>null;`],
 [/lib\/logging\/Logger\.js$/, `const L={}; for(const level of ['info','warn','error','debug','sampled']) L[level]=(event,data)=>{ (window.__logs??=[]).push({level,event,data,at:Date.now()}); }; L.child=()=>L; export default ()=>L; export const getLogger=()=>L;`],
 [/PianoKiosk\/PianoConfig\.jsx$/, `const config={ timezone:'America/Los_Angeles', keyboard:{startNote:21,endNote:108}, sheetmusic:{ defaultMode:'learn', learners:{ learner4:{ keyboardHints:'always', wrongNoteGhosts:true } }, learn:{ skipping:{ default:'open' }, certification:{ testOutFirst:false } } } }; export const usePianoKioskConfig=()=>({config}); export const usePianoKioskConfigOptional=()=>({config});`],
 [/PianoKiosk\/PianoUserContext\.jsx$/, `import {useSyncExternalStore} from 'react'; let user='learner4'; const subs=new Set(); const sub=f=>{subs.add(f);return()=>subs.delete(f)}; window.__profile=id=>{user=id;for(const f of subs)f()}; export const usePianoUser=()=>({currentUser:useSyncExternalStore(sub,()=>user,()=>user)});`],
 [/PianoKiosk\/PianoMidiContext\.jsx$/, `import {useSyncExternalStore} from 'react'; import {flushSync} from 'react-dom'; let notes=new Map();const subs=new Set(),events=new Set(),raws=new Set();window.__cc=(cc,v)=>{for(const f of raws)f({data:new Uint8Array([0xb0,cc,v])});};const sub=f=>{subs.add(f);return()=>subs.delete(f)}; const midi={connected:true,subscribe:f=>{events.add(f);return()=>events.delete(f)},subscribeRaw:f=>{raws.add(f);return()=>raws.delete(f)},pressNote:()=>{},releaseNote:()=>{},sendNoteAt:(note)=>{(window.__audio??=[]).push(note)},sendNoteOffAt:()=>{},sendPanic:()=>{}}; window.__hold=midis=>{const now=Date.now();const before=notes;flushSync(()=>{notes=new Map(midis.map(m=>[m,before.get(m)??{timestamp:now,velocity:80}]));for(const f of subs)f();});for(const midi of midis) if(!before.has(midi))for(const f of events)f({type:'note_on',note:midi,velocity:80,timeStamp:performance.now()});};export const usePianoMidi=()=>midi;export const usePianoMidiNotes=()=>({activeNotes:useSyncExternalStore(sub,()=>notes,()=>notes),noteHistory:[],sustainPedal:false});`],
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
const armed=async(page)=>{await page.locator('.piano-exercise-run[data-armed="true"]').waitFor({timeout:15000});await page.waitForTimeout(600);};
const openPassage=async(page)=>{await page.locator('.piano-passage-path__token[data-target]').click({timeout:30000});await armed(page);};
const shot=(page,name)=>page.screenshot({path:path.join(ARTIFACTS,`${name}.png`)});
const lit=(page)=>page.locator('.piano-exercise-run .piano-key.target').evaluateAll(list=>list.map(k=>Number(k.dataset.note)));
const ghosts=(page)=>page.locator('.piano-score-passage .piano-note-ghost').evaluateAll(list=>list.map(g=>({midi:Number(g.dataset.ghostMidi),ledgers:g.querySelectorAll('.piano-note-ghost__ledger').length,accidental:g.querySelectorAll('.piano-note-ghost__accidental').length,box:(()=>{const r=g.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})()})));
const owedBox=(page)=>page.locator('.piano-score-passage .piano-note-wrong').first().evaluate(el=>{const h=el.querySelector('.vf-notehead')??el;const r=h.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
const press=async(page,midi)=>{await page.evaluate(async(m)=>{window.__hold([m]);await new Promise(r=>setTimeout(r,80));window.__hold([]);},midi);await page.waitForTimeout(150);};

describe('learner assist: lit keys and wrong-note ghosts',()=>{
 it('lights the next key before any mistake, and draws a wrong note where it was played',async()=>{
  const{page,errors}=await open();try{
   await openPassage(page);
   // Nothing played yet: the key for the first note (C4) is already lit.
   expect(await lit(page)).toEqual([60]);
   // Fully lit, not the readers' muted half shade.
   expect(await page.locator('.piano-exercise-run .piano-keyboard.target-dim').count()).toBe(0);
   expect(await ghosts(page)).toEqual([]);
   await shot(page,'1-ready-lit-key');
   // A free take arms on its first correct note: play C4, and D4 is owed and lit.
   await press(page,60);
   expect(await lit(page)).toEqual([62]);
   // A wrong key a fourth up (G4): a translucent head in D's column, higher, no ledger.
   await press(page,67);
   let g=await ghosts(page);
   expect(g.map(x=>x.midi)).toEqual([67]);
   const owed=await owedBox(page);
   expect(g[0].box.y+g[0].box.h).toBeLessThan(owed.y+owed.h);
   expect(Math.abs((g[0].box.x+g[0].box.w/2)-(owed.x+owed.w/2))).toBeLessThan(owed.w/2);
   expect(g[0].ledgers).toBe(0);
   await shot(page,'2-wrong-g4-ghost');
   // A black key a step below (C#4): beside the owed D, with a sharp and middle C's ledger line.
   await press(page,61);
   g=await ghosts(page);
   expect(g.map(x=>x.midi)).toEqual([61]);
   expect(g[0].accidental).toBe(1);
   expect(g[0].ledgers).toBe(1);
   await shot(page,'3-wrong-csharp-ghost');
   // Well below the staff (A3): two ledger lines.
   await press(page,57);
   g=await ghosts(page);
   expect(g.map(x=>x.midi)).toEqual([57]);
   expect(g[0].ledgers).toBe(2);
   await shot(page,'4-wrong-a3-ghost');
   // The right note clears the ghost and the next key lights.
   await press(page,62);
   await page.waitForTimeout(300);
   expect(await ghosts(page)).toEqual([]);
   expect(await lit(page)).toEqual([64]);
   await shot(page,'5-next-key-lit');
   expect(errors).toEqual([]);
  }finally{await page.close();}
 },120000);
});
