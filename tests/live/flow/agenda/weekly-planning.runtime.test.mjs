import {test,expect} from './agendaTest.mjs';

test('creates and edits two independent weekly plans in Admin',async({page,request,agendaFixture:fixture},testInfo)=>{
  const readMenu=async(address,version='1')=>{
   const response=await request.get(`/api/v1/list/agenda/${fixture.id}/${address}`,{headers:{...fixture.headers,...(version ? {'X-Daylight-Participant-Launch-Version':version}:{})}});
   expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');expect(response.headers().vary).toMatch(/X-Daylight-Participant-Launch-Version/i);expect(response.headers().vary).toMatch(/Authorization/i);expect(response.headers().vary).toMatch(/Cookie/i);return response.json();
  };
  const noExecutable=menu=>{for(const row of menu.items){for(const field of ['open','play','queue','display','launch','participantLaunches'])expect(row[field]).toBeUndefined();}};
  const missing=await readMenu('current');expect(missing.notice).toMatch(/No plan/i);noExecutable(missing);
  await page.goto(`/tv?list=${encodeURIComponent(`agenda:${fixture.id}/current`)}`);await expect(page.getByText(/No plan/i)).toBeVisible();const adminLink=page.getByRole('link',{name:'Open Admin'});await expect(adminLink).toHaveAttribute('href',`/admin/content/agendas/${fixture.id}`);await page.keyboard.press('ArrowUp');await expect(adminLink).toBeFocused();await page.screenshot({path:testInfo.outputPath('tv-missing-admin-link.png')});
  await page.goto(`/admin/content/agendas/${fixture.id}`);
  await page.getByRole('button',{name:'Create this week'}).click();
  await expect(page.getByRole('heading',{name:'This week'})).toBeVisible();const draft=await readMenu('current');expect(draft.notice).toMatch(/not published/i);noExecutable(draft);
  await page.getByLabel('Title',{exact:true}).fill('Current acceptance week');
  await page.getByLabel('Named guest name').fill(fixture.guestName);await page.getByRole('button',{name:'Add named guest'}).click();
  await expect(page.getByText(fixture.guestName,{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Add anonymous guest'}).click();await page.getByRole('button',{name:'Add anonymous guest'}).click();
  await expect(page.getByLabel('Guest 1 name')).toBeVisible();await expect(page.getByLabel('Guest 2 name')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('admin-current-guest-controls.png'),fullPage:true});
  await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByText('published',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Back to series'}).click();await page.getByRole('button',{name:'Create next week'}).click();
  await expect(page.getByRole('heading',{name:'Next week'})).toBeVisible();await page.getByLabel('Title',{exact:true}).fill('Next acceptance week');
  await page.getByRole('button',{name:'Save draft'}).click();const heading=page.getByRole('heading',{name:'Next week'});await heading.scrollIntoViewIfNeeded();await expect(heading).toBeInViewport();const headingBox=await heading.boundingBox(),viewport=page.viewportSize();expect(headingBox.y).toBeGreaterThanOrEqual(0);expect(headingBox.y+headingBox.height).toBeLessThanOrEqual(viewport.height);await expect(page.getByText('People',{exact:true})).toBeInViewport();await page.screenshot({path:testInfo.outputPath('admin-next-week.png'),fullPage:true});
  await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByText('published',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Back to series'}).click();
  const plansResponse=await request.get(`${fixture.base}/${fixture.id}/plans`,{headers:fixture.headers});expect(plansResponse.ok()).toBe(true);
  const plans=(await plansResponse.json()).plans.map(p=>p.document);expect(plans).toHaveLength(2);
  const current=plans.find(p=>p.title==='Current acceptance week'),next=plans.find(p=>p.title==='Next acceptance week');
  expect(current.state).toBe('published');expect(current.participants).toHaveLength(3);expect(new Set(current.participants.map(p=>p.id)).size).toBe(3);expect(next.participants).toHaveLength(0);expect(next.plan_id).not.toBe(current.plan_id);expect(next.state).toBe('published');
  const future=await readMenu(`plans/${next.plan_id}`);expect(future.preview).toBe(true);noExecutable(future);
  const planPath=`${fixture.base}/${fixture.id}/plans/${current.plan_id}`;const record=await request.get(planPath,{headers:fixture.headers});expect(record.ok()).toBe(true);
  const cancelled=await request.post(`${planPath}/cancel`,{headers:{...fixture.headers,'If-Match':record.headers().etag},data:{}});expect(cancelled.ok()).toBe(true);
  const unavailable=await readMenu('current');expect(unavailable.notice).toMatch(/cancelled or archived/i);noExecutable(unavailable);
  const futureAfter=await readMenu(`plans/${next.plan_id}`);expect(futureAfter.preview).toBe(true);noExecutable(futureAfter);
  const series=await request.get(`${fixture.base}/${fixture.id}`,{headers:fixture.headers});expect(series.ok()).toBe(true);
  const archived=await request.post(`${fixture.base}/${fixture.id}/archive`,{headers:{...fixture.headers,'If-Match':series.headers().etag},data:{}});expect(archived.ok()).toBe(true);
  await page.goto('/admin/content/agendas');const history=page.locator('details').filter({has:page.getByText('Archived agendas',{exact:true})});const summary=history.locator('summary');await expect(history).not.toHaveAttribute('open');
  const ownLink=history.getByRole('link',{name:`Agenda ${fixture.id}`});await expect(ownLink).toBeHidden();await summary.focus();await page.keyboard.press('Enter');await expect(history).toHaveAttribute('open');await expect(ownLink).toBeVisible();await page.keyboard.press('Enter');await expect(history).not.toHaveAttribute('open');
});
