#!/usr/bin/env node
/** Real controlled editor + Agenda reducer in Chromium, with all network blocked. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {assertArchivedHistory} from '../../live/flow/agenda/archivedHistory.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const frontendRequire=createRequire(join(repo,'frontend/package.json'));
const sass=frontendRequire('sass-embedded');
const outDir=mkdtempSync(join(tmpdir(),'agenda-editor-pointer-'));
const bundle=await build({stdin:{resolveDir:repo,loader:'jsx',contents:`
 import React,{useState,useReducer} from 'react';
 import {createRoot} from 'react-dom/client';
 import {MantineProvider} from '@mantine/core';
 import '@mantine/core/styles.css';
 import {MemoryRouter} from 'react-router-dom';
 import ListDraftEditor from './__capabilities/content-catalog/browser/admin/ListDraftEditor.jsx';
 import AgendasIndex from './__app_modules/household/agenda/browser/admin/AgendasIndex.jsx';
 import {planDraftReducer} from './__app_modules/household/agenda/browser/admin/planDraftReducer.js';
 import {remapParticipantKeys} from './__app_modules/games/party-games/portable/participantSettings.mjs';
 const binding=mode=>({schema:'agenda-activity-setup/v1',action:'open',consumer:{id:'party-games',version:1},participants:{mode:'explicit',ids:['visitor']},settings:{schema:'party-games-participant-setup/v1',autostart:false,charades:{default_clue_mode:mode,clue_modes:{visitor:mode}}}});
 const plan={participants:[{id:'visitor',anonymous:true,display:{name:'Visitor',avatar:null}}],list:{sections:[{uid:'section',title:'Activities',items:[{uid:'alpha',label:'Alpha',open:'party-games/charades:alpha',image:'/neutral-alpha.png'},{uid:'beta',label:'Beta',open:'party-games/charades:beta',image:'/neutral-beta.png'},{uid:'gamma',label:'Gamma',open:'party-games/charades:gamma',image:'/neutral-gamma.png'}]}]},activity_settings:{alpha:binding('text'),beta:binding('image'),gamma:binding('reader')}};
 window.commands=[];
 function Editor(){
  const [state,dispatch]=useReducer(planDraftReducer,null,()=>planDraftReducer(null,{type:'load',document:plan,etag:'fixture'}));
  const [readOnly,setReadOnly]=useState(false);window.state=state;
  return <><button onClick={()=>setReadOnly(value=>!value)}>Toggle read only</button><ListDraftEditor list={state.draft.list} readOnly={readOnly} onEdit={command=>{window.commands.push(command);dispatch({type:'edit',command,options:{remapActivitySettings:({settings,participantKeyMap})=>remapParticipantKeys({settings,keyMap:participantKeyMap})}});}} renderItemSettings={({item})=><output data-uid={item.uid}>{item.uid}: {state.draft.activity_settings[item.uid]?.settings.charades.default_clue_mode}</output>}/></>;
 }
 const historyClient={seriesList:async()=>({document:{series:['unrelated','owned'].map(series_id=>({document:{series_id,title:'Acceptance',status:'archived'}}))}})};
 const root=createRoot(document.getElementById('root'));
 window.mount=mode=>root.render(<MantineProvider><MemoryRouter>{mode==='history'?<AgendasIndex client={historyClient}/>:<Editor/>}</MemoryRouter></MantineProvider>);
 `},bundle:true,write:false,outdir:'/fixture',format:'iife',jsx:'automatic',nodePaths:[join(repo,'frontend/node_modules')],alias:{'@':join(repo,'frontend/src'),'#frontend':join(repo,'frontend/src'),'@shared-gaming':join(repo,'shared/gaming'),'@shared-music':join(repo,'shared/music'),'@shared-contracts':join(repo,'shared/contracts'),'@shared-presentation':join(repo,'shared/presentation/scenes'),'@shared-interaction':join(repo,'shared/interaction'),react:join(repo,'frontend/node_modules/react'),'react-dom':join(repo,'frontend/node_modules/react-dom')},define:{'process.env.NODE_ENV':'"test"'},logLevel:'silent',loader:{'.svg':'dataurl'},plugins:[{name:'scss',setup(builder){
 // App display metadata is real; executable app bundles are outside this editor fixture.
 builder.onResolve({filter:/.*/},args=>args.kind==='dynamic-import' && args.importer.endsWith('/appRegistry.js') ? {path:args.path,namespace:'unused-app'} : null);
 builder.onLoad({filter:/.*/,namespace:'unused-app'},()=>({contents:'export default function UnusedApp(){throw Error("App launch outside editor fixture");}'}));
 builder.onLoad({filter:/\.scss$/},async({path})=>({contents:(await sass.compileAsync(path,{logger:sass.Logger.silent,loadPaths:[join(repo,'frontend/node_modules')]})).css,loader:'css'}));}}]});
const browser=await chromium.launch();
let page;
const errors=[];
try {
 page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.abort());
 await page.goto('about:blank');await page.setContent('<!DOCTYPE html><div id="root"></div>');
 await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
 if(process.argv.includes('--history')) {
  await page.evaluate(()=>window.mount('history'));
  await assertArchivedHistory(page,'owned','Acceptance');
  await page.screenshot({path:join(outDir,'history-closed.png')});
 } else {
  await page.evaluate(()=>window.mount('editor'));
  await page.locator('[data-uid="alpha"]').waitFor();
  const snapshot=()=>page.evaluate(()=>structuredClone(window.state));
  const initial=await snapshot();
  const row=uid=>page.locator('[data-uid="'+uid+'"]').locator('..').locator('.item-row');
  const evidence=[];
  const gesture=async(source,target,label)=>{
   await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();
   const from=await source.boundingBox(),to=await target.boundingBox();assert.ok(from&&to,label+' target geometry');
   await source.focus();
   await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
   await page.mouse.move(from.x+from.width/2+5,from.y+from.height/2+5,{steps:3});
   await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:20});await page.mouse.up();
   evidence.push({label,from,to});
  };
  await gesture(row('alpha').locator('.drag-handle'),row('beta').locator('.drag-handle'),'row reorder');
  await page.waitForFunction(()=>window.commands.some(command=>command.type==='move-item'));
  let current=await snapshot();assert.deepEqual(current.draft.list.sections[0].items.map(item=>item.uid),['beta','alpha','gamma']);
  assert.deepEqual(current.draft.activity_settings,initial.draft.activity_settings);
  assert.ok(await row('alpha').locator('.drag-handle').evaluate(el=>el===document.activeElement),'focus stays on moved UID handle');
  await page.screenshot({path:join(outDir,'row-reordered.png')});
  await gesture(row('alpha').locator('.col-content-drag'),row('beta').locator('.content-drop-zone'),'content swap');
  await page.waitForFunction(()=>window.commands.some(command=>command.type==='swap-items'));
  current=await snapshot();const items=current.draft.list.sections[0].items;
  assert.deepEqual(items.map(item=>item.uid),['beta','alpha','gamma']);
  assert.equal(items[0].open,'party-games/charades:alpha');assert.equal(items[0].image,'/neutral-alpha.png');
  assert.equal(items[1].open,'party-games/charades:beta');assert.equal(items[1].image,'/neutral-beta.png');
  assert.deepEqual(current.draft.activity_settings.beta,initial.draft.activity_settings.alpha);
  assert.deepEqual(current.draft.activity_settings.alpha,initial.draft.activity_settings.beta);
  assert.deepEqual(current.draft.activity_settings.gamma,initial.draft.activity_settings.gamma);
  assert.ok(await row('alpha').locator('.col-content-drag').evaluate(el=>el===document.activeElement),'content drag focus stays on source UID');
  await page.screenshot({path:join(outDir,'content-swapped.png')});
  // The intended UID alpha now contains Beta content. Edit via the actual modal portal.
  const edit=page.getByRole('button',{name:'Edit Beta',exact:true});await edit.click();
  const label=page.getByTestId('item-label-input');await label.fill('Edited Beta');
  assert.ok(await label.evaluate(el=>!!el.closest('[role="dialog"]')),'editor uses real modal');
  await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  current=await snapshot();assert.equal(current.draft.list.sections[0].items.find(item=>item.uid==='alpha').label,'Edited Beta');
  assert.deepEqual(current.draft.activity_settings.alpha,initial.draft.activity_settings.beta);
  assert.equal(current.draft.list.sections[0].items.find(item=>item.uid==='alpha').image,'/neutral-beta.png');
  await page.waitForFunction(()=>document.activeElement?.textContent==='Edit Edited Beta');
  await page.screenshot({path:join(outDir,'edited-focus.png')});
  await page.getByRole('button',{name:'Delete Edited Beta',exact:true}).click();current=await snapshot();
  assert.deepEqual(current.draft.list.sections[0].items.map(item=>item.uid),['beta','gamma']);assert.equal(current.draft.activity_settings.alpha,undefined);
  assert.deepEqual(current.draft.activity_settings.beta,initial.draft.activity_settings.alpha);assert.deepEqual(current.draft.activity_settings.gamma,initial.draft.activity_settings.gamma);
  await page.getByRole('button',{name:'Toggle read only'}).click();const before=await snapshot(),count=await page.evaluate(()=>window.commands.length);
  await gesture(row('beta').locator('.drag-handle'),row('gamma').locator('.drag-handle'),'readOnly reorder attempt');
  await gesture(row('beta').locator('.col-content-drag'),row('gamma').locator('.content-drop-zone'),'readOnly swap attempt');
  await page.keyboard.press('Enter');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.getByRole('button',{name:/^(Edit|Delete) /}).count(),0);
  assert.equal(await page.evaluate(()=>window.commands.length),count);assert.deepEqual(await snapshot(),before);
  await page.screenshot({path:join(outDir,'readonly.png')});
  writeFileSync(join(outDir,'proof.json'),JSON.stringify({evidence,commands:await page.evaluate(()=>window.commands),initial,final:await snapshot()},null,2));
 }
 assert.deepEqual(errors,[]);process.stdout.write(JSON.stringify({passed:true,mode:process.argv.includes('--history')?'history':'pointer',outDir})+'\n');
} catch(error) {
 await page?.screenshot({path:join(outDir,'failure.png')});
 writeFileSync(join(outDir,'failure.json'),JSON.stringify({message:error.message,errors,state:await page?.evaluate(()=>({state:window.state,commands:window.commands,html:document.body.innerText}))},null,2));
 process.stderr.write('Evidence: '+outDir+'\n');throw error;
} finally {await browser.close();}
