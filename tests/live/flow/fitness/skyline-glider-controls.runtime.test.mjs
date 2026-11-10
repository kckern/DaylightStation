import {test,expect} from '@playwright/test';
import {FRONTEND_URL} from '#fixtures/runtime/urls.mjs';
import {fileURLToPath} from 'node:url';
const fixtureUrl=FRONTEND_URL+'/@fs'+fileURLToPath(new URL('../../../_fixtures/fitness/skyline-controls.html',import.meta.url));

const course=(id,duration=6)=>({schema:'skyline-glider-course/v1',id,version:1,name:id==='test-first'?'Test first':'Test second',duration_s:duration,rpm:{min:30,max:130},motion:{filter_s:.25,deadband_rpm:2,response_s:.6,max_climb_rate:.3,max_descent_rate:.3,disconnect_grace_s:.75,slow_signal_grace_s:5},rules:{lives:3,invincibility_s:1,restart_delay_s:2,weapons:{enabled:true}},segments:[{id:'finish',type:'finish',start_s:duration}],entities:[]});
const press=(page,position,gesture='single')=>page.evaluate(({position,gesture})=>window.__skylineTest.press({action:position+'_'+gesture}),{position,gesture});
const pedal=(page,rpm)=>page.evaluate(rpm=>window.__skylineTest.pedal(rpm),rpm);
const phase=page=>page.locator('[data-control-phase]');

test.beforeEach(async({page})=>{
 await page.route('**/api/**',async route=>{
  const url=route.request().url();
  if(url.includes('/skyline-glider/courses'))return route.fulfill({json:{courses:[course('test-first'),course('test-second',60)]}});
  if(url.includes('/skyline-glider/world'))return route.fulfill({json:{next:'test-first',zones:[{id:'test',name:'Test',acts:[{id:'test-first',name:'Test first',status:'open'},{id:'test-second',name:'Test second',status:'open'}]}]}});
  if(url.includes('/skyline-glider/runs'))return route.fulfill({status:201,json:{created:true}});
  if(url.includes('/entitlements'))return route.fulfill({json:{items:[]}});
  if(url.includes('/static/img/users/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="40" fill="#79dfed"/></svg>'});
  return route.fulfill({json:{}});
 });
});

test('four physical buttons cover readiness, separate attacks, menu, save, replay and next',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixtureUrl);
 await expect(phase(page)).toHaveAttribute('data-control-phase','identity',{timeout:20000});
 await press(page,1);await expect(phase(page)).toHaveAttribute('data-control-phase','flights');
 await press(page,4);await page.waitForTimeout(500);await expect(phase(page)).toHaveAttribute('data-control-phase','ready');
 await pedal(page,65);await expect(phase(page)).toHaveAttribute('data-control-phase','flight',{timeout:8000});
 await press(page,1);await expect(page.getByTestId('skyline-glider-bombs')).toContainText('5');
 await press(page,2);await expect(page.getByTestId('skyline-glider-bombs')).toContainText('4');
 await press(page,3);await press(page,4);await page.waitForTimeout(100);
 expect((await page.evaluate(()=>__skylineTest.snapshot())).assignments).toEqual([{equipmentId:'test-bike',userId:'test-child'}]);
 await page.screenshot({path:'test-results/skyline-four-button-flight.png',fullPage:true});
 await press(page,4,'hold');await expect(phase(page)).toHaveAttribute('data-control-phase','menu');
 await press(page,2);await press(page,1);await expect(phase(page)).toHaveAttribute('data-control-phase','flight',{timeout:8000});
 await expect(phase(page)).toHaveAttribute('data-control-phase','result',{timeout:10000});
 await expect(page.getByText(/Flight saved/)).toBeVisible();
 await press(page,2);await expect(phase(page)).toHaveAttribute('data-control-phase','flight',{timeout:8000});
 await expect(phase(page)).toHaveAttribute('data-course-id','test-second');
 await pedal(page,0);await expect(phase(page)).toHaveAttribute('data-control-phase','crash',{timeout:6000});
 await pedal(page,130);await page.waitForTimeout(400);await expect(phase(page)).toHaveAttribute('data-control-phase','crash');
 await press(page,1);await expect(phase(page)).toHaveAttribute('data-control-phase','flight',{timeout:8000});
 expect(errors).toEqual([]);
});

test('other riders, guest, failed saves and another selector remain controllable',async({page})=>{
 let reject=true,records=[];
 await page.route('**/api/v1/fitness/skyline-glider/runs',async route=>{records.push(route.request().postDataJSON().record);await route.fulfill({status:reject?503:201,json:{created:!reject}})});
 await page.goto(fixtureUrl);
 await expect(phase(page)).toHaveAttribute('data-control-phase','identity',{timeout:20000});
 await press(page,4,'hold');await expect(phase(page)).toHaveAttribute('data-control-phase','roster');
 await press(page,2);await press(page,2);await press(page,2);await press(page,4);
 await press(page,4);await pedal(page,65);await expect(phase(page)).toHaveAttribute('data-control-phase','flight',{timeout:8000});
 await page.evaluate(()=>__skylineTest.press({selectorId:'other-pad',equipmentId:'other-bike',action:'1_single',userId:'outside-rider'}));
 await page.evaluate(()=>__skylineTest.disconnect());await page.waitForTimeout(1000);
 await press(page,4,'hold');await expect(phase(page)).toHaveAttribute('data-control-phase','menu');
 await press(page,3);await expect(page.getByText(/Save failed/)).toBeVisible();
 reject=false;await press(page,1);await expect(page.getByText(/Flight saved/)).toBeVisible();
 expect(records).toHaveLength(2);expect(records[0]).toEqual(records[1]);
 await press(page,4);await expect(phase(page)).toHaveAttribute('data-control-phase','identity',{timeout:20000});
 await page.setViewportSize({width:640,height:850});await page.screenshot({path:'test-results/skyline-four-button-riders.png',fullPage:true});
 expect(await page.locator('.skyline-controls button').evaluateAll(bs=>bs.map(b=>b.dataset.position))).toEqual(['1','2','3','4']);
});
