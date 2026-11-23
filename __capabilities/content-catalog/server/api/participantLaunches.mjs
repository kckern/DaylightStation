import express from 'express';
import {bodyFields,handler,installed,screenOrUserViewerFor} from '#api/utils/participantHttp.mjs';

export function createParticipantLaunchesRouter({householdId,service,logger}={}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  const routes={inspect:['ref','target','action'],begin:['ref','target','action','requestId','expectedSetupHash','intent'],resume:['ref','target','action','launchId'],describe:['target','action']};
  for (const [name,fields] of Object.entries(routes)) router.post(`/${name}`,handler(logger,async(req,res)=>{
    const viewer=screenOrUserViewerFor(req,householdId);
    const body=bodyFields(req.body,fields);
    const result=await installed(service)[name]({...body,viewer});
    if (name==='begin' || name==='resume') logger?.info?.('participant.launch.http',{operation:name,kind:result.kind});
    res.json(result);
  },{hideForbidden:true}));
  return router;
}
