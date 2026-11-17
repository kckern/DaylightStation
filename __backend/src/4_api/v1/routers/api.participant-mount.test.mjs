// @vitest-environment node
import {it,expect} from 'vitest';
import express from 'express';
import {createApiRouter} from './api.mjs';
import {createParticipantLaunchesRouter} from '../../../../../__capabilities/content-catalog/server/participant-launch.mjs';

it('mounts the actual participant API at its canonical path', async () => {
 const logger={info(){},warn(){},error(){},debug(){}};
 const participantLaunches=createParticipantLaunchesRouter({householdId:'home',logger,service:{describe:async ({viewer})=>({viewer})}});
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={sub:'host',roles:['parent']};next();});
 app.use('/api/v1',createApiRouter({safeConfig:{},routers:{participantLaunches},logger}));
 const server=app.listen(0);
 try {
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/participant-launches/describe`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'open',target:{kind:'app'}})});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({viewer:{role:'host',participant_id:'host',householdId:'home'}});
 } finally {server.close();}
});
