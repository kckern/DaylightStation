import {test,expect} from '@playwright/test';
import path from 'node:path';
const BASE=process.env.SCHOOL_GRATITUDE_BASE??process.env.BASE_URL;
const TODAY='2026-11-16',LEARNER='test-learner';
async function world(page,{refusal=null,followUp=false}={}){
  const state={phase:'draft',learnerId:LEARNER,studyDay:TODAY,today:TODAY,serverNow:'2026-11-16T18:00:00Z',prompt:{id:'gratitude',text:'What are you grateful for today?',required:true},draft:null,attemptId:null,retryAt:null};
  const submissions=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    // The ordinary household with supervision disabled; without this the screen waits on "Checking access…".
    if(url.pathname==='/api/v1/supervision/bootstrap')return json({enabled:false});
    if(url.pathname.endsWith('/roster'))return json([{id:LEARNER,name:'Test Learner',birthyear:2016}]);
    if(url.pathname.endsWith('/materials'))return json({materials:[]});
    if(url.pathname.endsWith('/banks')||url.pathname.endsWith('/sentence-ladder/courses'))return json([]);
    if(url.pathname.endsWith('/surfaces/profile'))return json({surfaceId:'portal'});
    if(url.pathname.endsWith('/direct-launch'))return json({target:{kind:'program',program:'gratitude',learnerId:LEARNER,gratitudeGrant:'test-grant',today:TODAY}});
    if(url.pathname.includes(`/gratitude/${LEARNER}/day/`)){
      expect(req.headers()['x-school-gratitude-grant']).toBe('test-grant');
      if(url.pathname.endsWith('/submit')){
        const body=req.postDataJSON();submissions.push(body);
        if(followUp&&submissions.length===1)Object.assign(state,{phase:'follow-up',attemptId:body.attemptId,followUp:{question:'What about your mom are you grateful for today?',firstText:body.text}});
        else Object.assign(state,refusal?{phase:'cooldown',reason:refusal,retryAt:'2026-11-16T18:30:00Z'}:{phase:'completed',subject:followUp?'Mom making pancakes':'Toys',followUp:null});
      }
      return json(state);
    }
    return json({});
  });
  await page.clock.setFixedTime(new Date('2026-11-16T18:00:00Z'));
  await page.setViewportSize({width:1280,height:800});
  await page.goto(`${BASE}/school/go/${LEARNER}/gratitude`);
  return {state,submissions};
}
test('gratitude typing saves the subject and finishes one daily obligation',async({page})=>{
  const {submissions}=await world(page);
  const field=page.getByRole('textbox');await expect(field).toBeVisible();
  await expect(field).not.toBeFocused();
  // A letter pressed on the page (not on the field) must focus the box and land in it.
  await page.keyboard.press('I');await expect(field).toBeFocused();await expect(field).toHaveValue('I');
  await field.press('Space');await expect(field).toHaveValue('I ');
  await field.fill("I'm grateful for my toys");await field.press('Enter');
  await expect(page.getByText('Toys',{exact:true})).toBeVisible();
  expect(submissions).toHaveLength(1);expect(submissions[0].via).toBe('typed');
  await page.screenshot({path:path.join('test-results/school-gratitude','accepted.png')});
});
for(const reason of ['nonsense','repetition'])test(`gratitude ${reason} cooldown survives reload and leaves other schoolwork accessible`,async({page})=>{
  await world(page,{refusal:reason});
  await page.getByRole('textbox').fill(reason==='nonsense'?'stinky stinky lalalal':'my nice toys');
  await page.getByRole('button',{name:/Submit/}).click();
  await expect(page.getByText('Take a little break')).toBeVisible();
  await page.reload();await expect(page.getByText('Take a little break')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.screenshot({path:path.join('test-results/school-gratitude',`${reason}.png`)});
  await page.getByRole('button',{name:'Close'}).click();
  await expect(page.getByText('Take a little break')).toHaveCount(0);
});
test('a general gratitude gets one follow-up and both answers finish the day',async({page})=>{
  const {submissions}=await world(page,{followUp:true});
  await page.getByRole('textbox').fill("I'm grateful for my mom");
  await page.getByRole('button',{name:/Submit/}).click();
  await expect(page.getByText('What about your mom are you grateful for today?')).toBeVisible();
  await expect(page.getByText(/You said: .I'm grateful for my mom/)).toBeVisible();
  const field=page.getByRole('textbox');await expect(field).toHaveValue('');
  await field.fill('She made me pancakes');
  await page.getByRole('button',{name:/Submit/}).click();
  await expect(page.getByText('Mom making pancakes',{exact:true})).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toMatchObject({text:'She made me pancakes',followUpOf:submissions[0].attemptId});
  await page.screenshot({path:path.join('test-results/school-gratitude','follow-up.png')});
});
