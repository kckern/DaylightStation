import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { YamlNutriListDatastore } from '../../../../backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealInstructionService } from '../../../../backend/src/3_applications/health/MealInstructionService.mjs';
import { MealFoodCommands } from '../../../../backend/src/3_applications/health/MealFoodCommands.mjs';
import { installHealthFixtures } from './healthFixtures.mjs';
const baseUrl=process.env.HEALTH_WORKFLOW_PREVIEW_URL;
if(!baseUrl)throw new Error('Set HEALTH_WORKFLOW_PREVIEW_URL to an isolated built preview server');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'health-meal-browser-'));
const store=new YamlNutriListDatastore({dataService:{user:{resolveDir:rel=>path.join(root,rel)}},logger:{info(){},warn(){}}});
const commands=new MealFoodCommands({nutritionItems:store});
const date='2026-09-06';
const initial=[{uuid:'broth',name:'Beef broth',grams:300,calories:90.5,protein:8.2,carbs:2.1,fat:1.5},{uuid:'tomato',name:'Tomatoes',grams:100,calories:25.5,protein:1.1,carbs:3.8,fat:0.1}].map(r=>({...r,userId:'u',date,mealTime:'evening',version:1,amount:r.grams,unit:'g',settled:false}));
await store.saveMany(initial);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.clock.install({time:new Date('2026-09-07T01:30:00Z')});
 await page.addInitScript(()=>{
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},configurable:true});
   window.MediaRecorder=class {
     constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';}
     start(){this.state='recording';}
     stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['fixture audio'],{type:'audio/webm'})});this.onstop?.();}
   };
 });
 const fixtures=await installHealthFixtures(page,{items:initial});
 const sync=async()=>{fixtures.items=await store.findByDate('u',date);};
 await page.route('**/api/v1/health/nutrition/meal-*',async route=>{
   const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);const input=route.request().postDataJSON();
   try{
    if(endpoint==='meal-suggestions')return route.fulfill({json:{groups:[{name:'Tomato soup',selectedIds:['broth','tomato']}],expectedVersions:Object.fromEntries((await store.findByDate('u',date)).map(r=>[r.uuid,r.version]))}});
    const result=endpoint==='meal-undo'?await commands.undo('u',input):await commands.execute('u',input);
    await sync();return route.fulfill({json:result});
   }catch(err){return route.fulfill({status:err.status||500,json:{error:err.message}});}
 });
 let intent='amend', releaseCapture=null, holdCapture=null, failCapture=false;
 const inputBodies=[];
 const interpreter=new MealInstructionService({nutritionItems:store,mealCommands:commands,aiGateway:{chat:async()=>JSON.stringify(intent==='clarify'?{intent:'clarification',candidateIds:['broth','tomato'],message:'Which food?'}:intent==='group'?{intent:'group',targetIds:['broth','tomato'],name:'Voice soup'}:{intent:'amend',targetIds:['broth'],additions:[{parentId:'broth',name:'Potatoes',grams:100,calories:80,protein:2,carbs:18,fat:0.1}]})}});
 await page.route('**/api/v1/health/nutrition/input',async route=>{
   const body=route.request().postDataJSON();inputBodies.push(body);
   if(holdCapture)await holdCapture;
   if(failCapture){failCapture=false;return route.fulfill({status:503,json:{error:'Connection interrupted. Retry this recording.'}});}
   try{
    if(body.clarification)intent='amend';
    const result=await interpreter.execute('u',{...body,text:'The beef broth also had potatoes'});
    await sync();return route.fulfill({json:result});
   }catch(err){return route.fulfill({status:err.status||500,json:{error:err.message}});}
 });
 await page.goto(baseUrl+'/health?date='+date,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Log by voice to Dinner',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/voice.*Dinner/}).count(),1);
 await page.getByRole('button',{name:'Add food to Dinner',exact:true}).click();
 assert.equal(await page.getByRole('combobox',{name:'Food name or sentence'}).count(),0);
 await page.getByRole('button',{name:'Add food to Dinner',exact:true}).click();
 await page.getByRole('button',{name:'Select foods',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select Beef broth',exact:true}).check();
 await page.getByRole('checkbox',{name:'Select Tomatoes',exact:true}).check();
 await page.getByRole('button',{name:'Group selected foods'}).click();
 await page.getByRole('textbox',{name:'Dish name',exact:true}).fill('Tomato soup');
 await page.getByRole('button',{name:'Create dish',exact:true}).click();
 await page.getByRole('button',{name:'Collapse Tomato soup',exact:true}).waitFor();
 assert.equal((await store.findByDate('u',date)).filter(r=>r.kind==='group').length,1);
 await page.screenshot({path:'/tmp/health-meal-workflow-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Undo meal change'}).click();
 await page.getByRole('button',{name:'Collapse Tomato soup',exact:true}).waitFor({state:'detached'});
 assert.equal((await store.findByDate('u',date)).length,2);
 await page.getByRole('button',{name:'Suggest groups',exact:true}).click();
 await page.getByRole('textbox',{name:'Suggested dish 1'}).waitFor();
 assert.equal((await store.findByDate('u',date)).length,2);
 await page.getByRole('button',{name:'Apply suggested groups'}).click();
 await page.getByRole('button',{name:'Collapse Tomato soup',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit groups',exact:true}).click();
 await page.getByRole('button',{name:'Ungroup',exact:true}).click();
 await page.getByRole('button',{name:'Collapse Tomato soup',exact:true}).waitFor({state:'detached'});
 assert.equal((await store.findByDate('u',date)).length,2);
 const record=async()=>{
   await page.getByRole('button',{name:'Log by voice to Dinner',exact:true}).click();
   await page.getByRole('button',{name:'Stop recording — Dinner',exact:true}).click();
 };
 holdCapture=new Promise(resolve=>{releaseCapture=resolve;});
 await record();await page.getByRole('progressbar').waitFor();
 await page.clock.fastForward(17000);
 await page.getByText('Still analyzing…',{exact:true}).waitFor();
 releaseCapture();holdCapture=null;
 await page.getByRole('button',{name:'Edit Potatoes',exact:true}).waitFor();
 assert.equal((await store.findByDate('u',date)).filter(r=>r.name==='Beef broth' && r.kind!=='group').length,1);
 assert.equal(await page.getByRole('progressbar').count(),0);
 await page.getByRole('button',{name:'Undo meal change'}).click();
 await page.getByRole('button',{name:'Edit Potatoes',exact:true}).waitFor({state:'detached'});
 intent='clarify';await record();
 await page.getByText('Which food?',{exact:true}).waitFor();
 assert.equal((await store.findByDate('u',date)).length,2);
 await page.getByRole('button',{name:'Beef broth',exact:true}).click();
 await page.getByRole('button',{name:'Edit Potatoes',exact:true}).waitFor();
 await page.getByRole('button',{name:'Undo meal change'}).click();
 await page.getByRole('button',{name:'Edit Potatoes',exact:true}).waitFor({state:'detached'});
 intent='group';failCapture=true;await record();
 await page.getByRole('button',{name:'Retry recording',exact:true}).waitFor();
 const failedId=inputBodies.at(-1).operationId;
 await page.getByRole('button',{name:'Retry recording',exact:true}).click();
 await page.getByRole('button',{name:'Collapse Voice soup',exact:true}).waitFor();
 assert.equal(inputBodies.at(-1).operationId,failedId);
 await page.getByRole('button',{name:'Undo meal change'}).click();
 await page.getByRole('button',{name:'Collapse Voice soup',exact:true}).waitFor({state:'detached'});
 for(const width of [390,800,1440]){
  await page.setViewportSize({width,height:1000});
  await page.screenshot({path:`/tmp/health-meal-workflow-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(fixtures.unexpected,[]);
 console.log(JSON.stringify({manualGroup:true,smartPreview:true,smartApply:true,ungroup:true,undo:true,foodRowsPreserved:true,singleDinnerMic:true,noDefaultCatalog:true,voiceAmend:true,voiceGroup:true,clarification:true,slowProgress:true,retrySameOperation:true,browserErrors:errors}));
}finally{await browser.close();fs.rmSync(root,{recursive:true,force:true});}
