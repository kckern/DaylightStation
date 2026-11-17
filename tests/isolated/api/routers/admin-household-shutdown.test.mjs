import {it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createAdminHouseholdRouter} from '../../../../__backend/src/4_api/v1/routers/admin/household.mjs';
import {permissionGate} from '../../../../__backend/src/4_api/middleware/permissionGate.mjs';
function fixture({householdId='home',authenticated=true}={}){
 const read=vi.fn(async()=>({mode:'legacy',locked:true,enforcement:{incidentReportingError:'INCIDENT_REPORTING_UNAVAILABLE',consumers:[{deviceId:'portal',capability:'portal-keys',acknowledged:false}],incidents:[]}}));
 const app=express();app.use((req,res,next)=>{req.householdId=householdId;req.roles=authenticated?['owner']:[];req.user=authenticated?{id:'parent'}:null;next();});
 app.use('/api/v1',permissionGate({roles:{owner:{apps:['admin']}},appRoutes:{admin:['admin/*']}}));
 app.use('/api/v1/admin/household',createAdminHouseholdRouter({householdAdminService:{},shutdownDiagnostics:{householdId:'home',read}}));return {app,read};
}
it('serves legacy evidence through the existing authenticated admin route',async()=>{
 const {app}=fixture();const response=await request(app).get('/api/v1/admin/household/shutdown/status');expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.body.enforcement).toMatchObject({incidentReportingError:'INCIDENT_REPORTING_UNAVAILABLE',consumers:[{deviceId:'portal'}]});
});
it('requires admin authentication before reading Stop diagnostics',async()=>{
 const {app,read}=fixture({authenticated:false});expect((await request(app).get('/api/v1/admin/household/shutdown/status')).status).toBe(401);expect(read).not.toHaveBeenCalled();
});
it('rejects another household instead of returning the bound household diagnostics',async()=>{
 const {app,read}=fixture({householdId:'other'});expect((await request(app).get('/api/v1/admin/household/shutdown/status')).status).toBe(404);expect(read).not.toHaveBeenCalled();
 const home=fixture();expect((await request(home.app).get('/api/v1/admin/household/shutdown/status?householdId=other')).status).toBe(404);expect(home.read).not.toHaveBeenCalled();
});
