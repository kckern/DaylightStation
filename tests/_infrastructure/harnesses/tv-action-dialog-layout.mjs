#!/usr/bin/env node
/** Real dialog, launch host, preview and input in Chromium; no server or household requests. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = mkdtempSync(join(tmpdir(), 'tv-action-dialog-'));
const bundle = await build({
  stdin: { resolveDir: repo, loader: 'jsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import '@mantine/core/styles.css';
    import {ParticipantLaunchHost} from './frontend/src/composition/participants/ParticipantLaunchHost.jsx';
    import {PartyGamesParticipantPreview} from './__app_modules/games/party-games/browser/participants/PartyGamesParticipantPreview.jsx';
    import {getActionBus,GamepadAdapter} from './__capabilities/screen-host/browser/input.mjs';
    const bus=getActionBus(), adapter=new GamepadAdapter(bus);
    window.behind=0; window.started=0; window.closeCount=0;
    bus.subscribe('navigate',()=>window.behind++); bus.subscribe('select',()=>window.behind++);
    window.remote=direction=>adapter._emit({action:'navigate',key:'Arrow'+direction[0].toUpperCase()+direction.slice(1),payload:{direction}});
    window.select=()=>adapter._emit({action:'select',key:'Enter'});
    const root=createRoot(document.getElementById('root'));
    window.mount=count=>root.render(<ParticipantLaunchHost key={count} refValue={{provider:'neutral',ref:'fixture'}} action="open"
      client={{inspect:async()=>({schema:'participant-launch-options/v1',ready:true,confirmation:'required',consumer:{id:'party-games',version:1},setup_hash:'fixture',choices:[],consumer_summary:{schema:'party-games-preview/v2',data:{participants:Array.from({length:count},(_,i)=>({name:'Person '+(i+1),clue_mode:'text'}))}}}),begin:async()=>{window.started++;return {schema:'participant-launch-result/v1',kind:'ready'};}}}
      requestIdFactory={()=>'fixture-request'} resolvePreview={()=>PartyGamesParticipantPreview} onClose={()=>window.closeCount++}/>);
  ` },
  bundle: true, write: false, outdir: '/fixture', format: 'iife', jsx: 'automatic',
  nodePaths: [join(repo, 'frontend/node_modules')],
  alias: {'@shared-interaction':join(repo,'shared/interaction'),react: join(repo,'frontend/node_modules/react'),'react-dom':join(repo,'frontend/node_modules/react-dom')},
  define: {'process.env.NODE_ENV':'"test"'}, logLevel:'silent',
});
const browser=await chromium.launch();
const evidence=[];
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  for (const [count,width] of [[3,1280],[20,1280],[3,320],[20,320]]) {
    await page.goto('about:blank');
    await page.setViewportSize({width:1280,height:720});
    await page.setContent('<!DOCTYPE html><div id="root"></div>');
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.evaluate(count=>window.mount(count),count);
    const list=page.getByRole('list',{name:'Participants and clue modes'});
    await list.waitFor();
    await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-tv-scroll'));
    const normalPanel=await page.locator('.tv-action-dialog__panel').boundingBox();
    assert.ok(normalPanel.y>=0 && normalPanel.y+normalPanel.height<=720,'normal panel fits viewport');
    for (const locator of [page.getByText('Review activity'),list,page.getByRole('button',{name:'Start',exact:true}),page.getByRole('button',{name:'Back',exact:true})]) {
      const bounds=await locator.boundingBox();
      assert.ok(bounds.y>=normalPanel.y && bounds.y+bounds.height<=normalPanel.y+normalPanel.height,'normal content and controls visible');
    }
    // Match the managed regression: focus already exists when the viewport shrinks.
    await page.setViewportSize({width,height:160});
    await list.focus();
    const geometry=()=>list.evaluate(el=>{
      const box=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};
      const panel=el.closest('.tv-action-dialog__panel');
      return {list:box(el),last:box(el.lastElementChild),panel:box(panel),innerTop:el.scrollTop,outerTop:panel.scrollTop,max:el.scrollHeight-el.clientHeight};
    });
    for(let i=0;i<30;i++) {
      const g=await geometry();if(g.innerTop>=g.max-1)break;
      if(count===3)await page.keyboard.press('ArrowDown');else await page.evaluate(()=>window.remote('down'));
    }
    const g=await geometry();
    await page.screenshot({path:join(outDir,`participants-${count}-${width}.png`)});
    writeFileSync(join(outDir,`geometry-${count}-${width}.json`),JSON.stringify(g,null,2));
    assert.ok(g.max>0 && g.innerTop>=g.max-1,'list genuinely overflows and reaches bottom');
    assert.ok(g.panel.top>=0 && g.panel.bottom<=160,'panel fits viewport: '+JSON.stringify(g));
    assert.ok(g.last.top>=Math.max(g.list.top,g.panel.top,0)-1 && g.last.bottom<=Math.min(g.list.bottom,g.panel.bottom,160)+1,'last participant fully visible: '+JSON.stringify(g));
    await page.evaluate(()=>window.select());assert.equal(await page.evaluate(()=>window.started),0);
    await page.keyboard.press('ArrowDown');
    const start=page.getByRole('button',{name:'Start',exact:true});
    assert.ok(await start.evaluate(el=>el===document.activeElement),'Start focused');
    const checkControl=async locator=>{
      const bounds=await locator.boundingBox();const panel=await page.locator('.tv-action-dialog__panel').boundingBox();
      assert.ok(bounds.y>=Math.max(0,panel.y)-1 && bounds.y+bounds.height<=Math.min(160,panel.y+panel.height)+1,'focused control fully visible: '+JSON.stringify({bounds,panel}));
    };
    await checkControl(start);
    await page.screenshot({path:join(outDir,`start-${count}-${width}.png`)});
    await page.evaluate(()=>window.remote('down'));
    const back=page.getByRole('button',{name:'Back',exact:true});assert.ok(await back.evaluate(el=>el===document.activeElement));await checkControl(back);
    await page.screenshot({path:join(outDir,`back-${count}-${width}.png`)});
    await page.keyboard.press('ArrowDown');assert.ok(await list.evaluate(el=>el===document.activeElement));
    for(let i=0;i<30 && (await geometry()).innerTop>0;i++) await page.evaluate(()=>window.remote('up'));
    const first=await list.getByRole('listitem').first().boundingBox();const upper=await geometry();
    assert.ok(first.y>=Math.max(upper.list.top,upper.panel.top,0)-1 && first.y+first.height<=Math.min(upper.list.bottom,upper.panel.bottom,160)+1,'first participant fully visible after return');
    await page.keyboard.press('ArrowUp');assert.ok(await back.evaluate(el=>el===document.activeElement));
    await page.evaluate(()=>window.select());assert.equal(await page.evaluate(()=>window.closeCount),1);
    assert.equal(await page.evaluate(()=>window.behind),0,'dialog captures all input');
    await page.setViewportSize({width:1280,height:720});
    await page.keyboard.press('ArrowDown');
    await page.screenshot({path:join(outDir,`normal-${count}-${width}.png`)});
    await page.keyboard.press('ArrowRight');
    assert.ok(await start.evaluate(el=>el===document.activeElement));
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.started===1);
    evidence.push({count,width,...g});
  }
  assert.deepEqual(errors,[]);
  process.stdout.write(JSON.stringify({passed:evidence.length,evidence,outDir})+'\n');
} finally { await browser.close(); }
