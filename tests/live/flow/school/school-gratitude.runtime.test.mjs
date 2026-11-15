import {test,expect} from '@playwright/test';
import path from 'node:path';
const BASE=process.env.SCHOOL_GRATITUDE_BASE??process.env.BASE_URL;
const TODAY='2026-11-16',LEARNER='test-learner';
async function world(page,{refusal=null}={}){
  const state={phase:'draft',learnerId:LEARNER,studyDay:TODAY,today:TODAY,serverNow:'2026-11-16T18:00:00Z',prompt:{id:'gratitude',text:'What are you grateful for today?',required:true},draft:null,attemptId:null,retryAt:null};
  const submissions=[];
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    if(url.pathname.endsWith('/roster'))return json([{id:LEARNER,name:'Test Learner',birthyear:2016}]);
    if(url.pathname.endsWith('/materials'))return json({materials:[]});
    if(url.pathname.endsWith('/banks')||url.pathname.endsWith('/sentence-ladder/courses'))return json([]);
    if(url.pathname.endsWith('/surfaces/profile'))return json({surfaceId:'portal'});
    if(url.pathname.endsWith('/direct-launch'))return json({target:{kind:'program',program:'gratitude',learnerId:LEARNER,gratitudeGrant:'test-grant',today:TODAY}});
    if(url.pathname.includes(`/gratitude/${LEARNER}/day/`)){
      expect(req.headers()['x-school-gratitude-grant']).toBe('test-grant');
      if(url.pathname.endsWith('/submit')){
        const body=req.postDataJSON();submissions.push(body);
        Object.assign(state,refusal?{phase:'cooldown',reason:refusal,retryAt:'2026-11-16T18:30:00Z'}:{phase:'completed',subject:'Toys'});
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
  await field.press('Space');await expect(field).toHaveValue(' ');
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
  await page.getByRole('button',{name:'Back to School'}).click();
  await expect(page.getByText('Take a little break')).toHaveCount(0);
});
