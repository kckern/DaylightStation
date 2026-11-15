import {test,expect} from '@playwright/test';
// Deliberately requires an explicitly arranged drill; never run a household Stop as a smoke test.
const base=process.env.SUPERVISION_DRILL_BASE_URL;
const views=JSON.parse(process.env.SUPERVISION_DRILL_VIEWS??'[]');
const parent={username:process.env.SUPERVISION_DRILL_PARENT,password:process.env.SUPERVISION_DRILL_PASSWORD};
test.beforeAll(()=>{
 if(process.env.SUPERVISION_SAFE_DRILL!=='yes' || !base || !parent.username || !parent.password)throw Error('Arrange an explicit safe drill and supply its URL and parent credentials.');
 const labels=new Set(views.map(view=>view.label));for(const label of ['garage','bank','reward','code','piano','arcade'])if(!labels.has(label))throw Error(`Missing drill coverage: ${label}`);
});
async function paired(browser,view){
 const context=await browser.newContext({baseURL:base});
 const response=await context.request.post('/api/v1/supervision/enroll',{data:{...parent,deviceId:view.deviceId}});expect(response.ok()).toBe(true);
 const page=await context.newPage();await page.goto(view.path);return {context,page};
}
async function parentCommand(request,action){const response=await request.post(`${base}/api/v1/supervision/parent-command`,{data:{...parent,action}});expect(response.ok()).toBe(true);return response.json();}
test('real administrator scan stops Garage, Portal bank/reward/code, Piano and arcade views',async({browser,request})=>{
 test.setTimeout(120000);await parentCommand(request,'release');
 const sessions=await Promise.all(views.map(view=>paired(browser,view)));
 try{
  for(let i=0;i<views.length;i++)await expect(sessions[i].page.locator(views[i].childSelector)).toBeVisible();
  // Operator now scans the actual owner/guardian fingerprint in normal context.
  // No fabricated biometric payload, browser actor or direct Stop API substitutes for this step.
  await Promise.all(sessions.map(({page})=>expect(page.getByText('Paused by a parent',{exact:true})).toBeVisible({timeout:60000})));
  for(let i=0;i<views.length;i++){await expect(sessions[i].page.locator(views[i].childSelector)).toHaveCount(0);await sessions[i].page.reload();await expect(sessions[i].page.getByText('Paused by a parent',{exact:true})).toBeVisible();}
  const released=await parentCommand(request,'release');expect(released.active).toBe(false);
  for(const {page} of sessions){await expect(page.getByRole('button',{name:'Return to menu'})).toBeVisible();await expect(page.getByRole('button',{name:'Parent controls'})).toBeVisible();}
 }finally{await Promise.all(sessions.map(({context})=>context.close()));}
});
test('network loss closes mounted child activity within the five-second permit bound',async({browser,request})=>{
 await parentCommand(request,'release');const view=views[0],{context,page}=await paired(browser,view);
 try{await expect(page.locator(view.childSelector)).toBeVisible();await context.setOffline(true);await expect(page.locator(view.childSelector)).toHaveCount(0,{timeout:6000});await expect(page.getByRole('button',{name:'Parent controls'})).toBeVisible();}
 finally{await context.close();}
});
