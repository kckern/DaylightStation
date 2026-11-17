import {it,expect} from 'vitest';
import {AgendaContentAdapter} from './AgendaContentAdapter.mjs';

it('resolves the exact local week and exposes published weeks as previews', async () => {
  const plans = [{plan_id:'old',series_id:'s',household_id:'h',week_of:'2026-11-02',state:'published'}, {plan_id:'next',series_id:'s',household_id:'h',week_of:'2026-11-16',state:'published'}];
  const adapter = new AgendaContentAdapter({repository:{readSeries:async()=>({document:{series_id:'s',household_id:'h',title:'Gather',status:'active',calendar:{timezone:'America/Los_Angeles'}}}),listPlans:async()=>plans.map(document=>({document})),readPlanInSeries:async ({planId})=>({document:plans.find(p=>p.plan_id===planId)})},resolveHousehold:()=> 'h',clock:()=>new Date('2026-11-15T23:00:00Z'),projector:{project:async ({plan,preview})=>({id:`agenda:s/plans/${plan.plan_id}`,items:[],preview})}});
  expect((await adapter.getList('s',{viewer:{}})).notice).toMatch(/2026-11-09/);
  expect((await adapter.getList('s/plans/next',{viewer:{}})).preview).toBe(true);
  expect((await adapter.getList('s/weeks',{viewer:{}})).items.map(i=>i.id)).toEqual(['agenda:s/plans/next','agenda:s/plans/old']);
  expect(adapter.getCapabilities()).toEqual(['listable']);
});

it('distinguishes unpublished, cancelled, empty, preview and archived states', async () => {
 let seriesStatus='active'; let plans=[];
 const adapter=new AgendaContentAdapter({repository:{readSeries:async()=>({document:{title:'Gather',status:seriesStatus,calendar:{timezone:'UTC'}}}),listPlans:async()=>plans.map(document=>({document}))},resolveHousehold:()=> 'h',clock:()=>new Date('2026-11-11T12:00:00Z'),projector:{project:async({plan,preview})=>({id:`agenda:s/plans/${plan.plan_id}`,items:[],preview})}});
 const plan={plan_id:'p',week_of:'2026-11-09',state:'draft'};
 expect((await adapter.getList('s/current')).notice).toMatch(/No plan/);
 plans=[plan]; expect((await adapter.getList('s/current')).notice).toMatch(/not published/);
 plan.state='cancelled'; expect((await adapter.getList('s/current')).notice).toMatch(/cancelled/);
 plan.state='published'; expect((await adapter.getList('s/current')).notice).toMatch(/empty/);
 plan.week_of='2026-11-16'; expect((await adapter.getList('s/plans/p')).preview).toBe(true);
 plan.week_of='2026-11-02'; expect((await adapter.getList('s/plans/p')).preview).toBe(true);
 seriesStatus='archived'; expect((await adapter.getList('s/plans/p')).notice).toMatch(/archived/);
 expect((await adapter.getList('s/current')).adminUrl).toBe('/admin/content/agendas/s');
});
