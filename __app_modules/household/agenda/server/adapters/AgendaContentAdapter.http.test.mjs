import {it,expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {ContentSourceRegistry} from '../../../../../__capabilities/content-catalog/server/adapters/ContentSourceRegistry.mjs';
import {RegistryContentCatalogGateway} from '../../../../../__capabilities/content-catalog/server/adapters/RegistryContentCatalogGateway.mjs';
import {ListBrowseService} from '../../../../../__capabilities/content-catalog/server/application/services/ListBrowseService.mjs';
import {createListRouter} from '../../../../../__capabilities/content-catalog/server/api/list.mjs';
import {ListMenuProjector} from '../../../../../__capabilities/content-catalog/server/list-menu-projector.mjs';
import {AgendaMenuProjector} from '../application/AgendaMenuProjector.mjs';
import {AgendaContentAdapter} from './AgendaContentAdapter.mjs';
import {AgendaLaunchRefCodec} from './AgendaLaunchRefCodec.mjs';

it('transports viewer, protocol, references, notices and privacy through real registered list path', async () => {
 const plan={household_id:'h',series_id:'s',plan_id:'p',revision:1,week_of:'2026-11-09',title:'Gather',state:'published',list:{sections:[{items:[{uid:'game',title:'Game',open:{app:'game'}}]}]},activity_settings:{game:{action:'open',consumer:{id:'game',version:1}}}};
 const repo={readSeries:async()=>({document:{title:'Gather',status:'active',calendar:{timezone:'America/Los_Angeles'}}}),listPlans:async()=>[{document:plan}]};
 let targetUnavailable=false;
 const projector=new AgendaMenuProjector({listProjector:new ListMenuProjector(),codec:new AgendaLaunchRefCodec(),resolveTarget:async()=>{if (targetUnavailable) throw Error('unavailable'); return {kind:'app',id:'game'};},logger:{warn(){}},registry:{resolve:()=>({id:'game',version:1})}});
 const source=new AgendaContentAdapter({repository:repo,projector,clock:()=>new Date('2026-11-15T23:00:00Z'),resolveHousehold:({viewer})=>viewer.householdId});
 const registry=new ContentSourceRegistry(); registry.register(source);
 const gateway=new RegistryContentCatalogGateway({registry});
 const address=gateway.resolve('agenda:s/current');
 expect(gateway.capabilities({id:'agenda:s/current',itemType:'container'},address)).toEqual(['listable']);
 expect(await gateway.resolvePlayables(address)).toBeNull();
 expect(await gateway.resolveSiblings(address)).toBeNull();
 const browse=new ListBrowseService({contentCatalog:gateway,contentIdResolver:{resolve:id=>gateway.resolve(id)}});
 const app=express(); app.use((req,res,next)=>{req.user={sub:'u',householdId:'h'};next()}); app.use('/list',createListRouter({listBrowse:browse,viewerForRequest:req=>({householdId:req.user.householdId,participant_id:req.user.sub})}));
 const supported=await request(app).get('/list/agenda/s/current').set('X-Daylight-Participant-Launch-Version','1');
 expect(supported.status).toBe(200); expect(supported.body.revision).toBe(1); expect(supported.body.items[0].participantLaunches.open.schema).toBe('participant-launch-ref/v1');
 expect(supported.body.items[0].open).toEqual({app:'game'});
 expect(supported.body.notice).toBeUndefined();
 expect(supported.body.items).toHaveLength(1); // a published week lists only its activities
 expect(supported.headers['cache-control']).toBe('private, no-store'); expect(supported.headers.vary).toMatch(/X-Daylight-Participant-Launch-Version/i);
 const legacy=await request(app).get('/list/agenda/s/current');
 const unsupported=await request(app).get('/list/agenda/s/current').set('X-Daylight-Participant-Launch-Version','01');
 for (const response of [legacy,unsupported]) {
   expect(response.status).toBe(200);
   expect(response.body.notice).toMatch(/update/i);
   expect(response.body.items[0].disabled).toBe(true);
   for (const key of ['open','play','queue','display','launch','list','participantLaunches']) expect(response.body.items[0][key]).toBeUndefined();
 }
 plan.activity_settings={};
 const invalid=await request(app).get('/list/agenda/s/current');
 expect(invalid.body.items[0].disabled).toBe(true);
 expect(invalid.body.notice || '').not.toMatch(/update/i);
 plan.activity_settings={game:{action:'open',consumer:{id:'game',version:2}}};
 const mismatched=await request(app).get('/list/agenda/s/current');
 expect(mismatched.body.notice || '').not.toMatch(/update/i);
 plan.activity_settings.game.consumer.version=1; targetUnavailable=true;
 const unavailable=await request(app).get('/list/agenda/s/current');
 expect(unavailable.body.notice || '').not.toMatch(/update/i);
 targetUnavailable=false; plan.state='draft';
 const draft=await request(app).get('/list/agenda/s/current');
 expect(draft.body.notice).toMatch(/not published/i);
 expect(draft.body.notice).not.toMatch(/update/i);
 plan.state='published'; plan.week_of='2026-11-16';
 const preview=await request(app).get('/list/agenda/s/plans/p');
 expect(preview.body.notice).toMatch(/preview/i);
 expect(preview.body.notice).not.toMatch(/update/i);
 expect((await request(app).get('/list/agenda/s/current/playable')).status).toBe(400);
});

it('does not repurpose legacy sources second positional options', async () => {
 let received;
 const source={source:'legacy',prefixes:[],getItem:async()=>null,getList:async (...args)=>{received=args;return []}};
 const registry=new ContentSourceRegistry(); registry.register(source);
 const gateway=new RegistryContentCatalogGateway({registry});
 await gateway.getList(gateway.resolve('legacy:one'),'legacy:one',{viewer:{participant_id:'viewer'},participantLaunchVersion:1});
 expect(received).toEqual(['legacy:one']);
});
