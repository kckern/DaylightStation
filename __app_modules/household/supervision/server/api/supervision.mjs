import express from 'express';
import {asyncHandler,errorHandlerMiddleware} from '#system/http/middleware/index.mjs';
import {requireAdult} from '../../shared/contracts.mjs';
export function createSupervisionRouter({service,scopeId,authenticateParent,authenticateKiosk,makeId,identity=null,getIdentity=()=>null,guard=null,clock=null,getBootstrap=null,verifyParentCredentials=null,enrollKiosk=null,ackConsumer=null,getHealth=null,workflow=null,callbackAuthority=null,logger=null,getCatalog=null,getDiagnostics=null,renewNativeLease=null}){
  const router=express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const requestContext=async req=>{const identity=await authenticateKiosk(req);return {deviceId:identity.deviceId,clientSessionId:identity.sessionId,activityId:req.body?.activityId??req.query.activityId,learnerId:req.body?.learnerId??req.query.learnerId,requestId:req.params.id,sessionId:req.body?.sessionId??req.query.sessionId};};
  router.post('/native-lease',asyncHandler(async(req,res)=>{
    if(!renewNativeLease)return res.status(503).json({error:'NATIVE_LEASE_UNAVAILABLE'});
    const header=req.headers.authorization,credentials=typeof header==='string' && header.startsWith('Bearer ')?header.slice(7):null;
    res.json(await renewNativeLease({credentials,packageName:req.body?.packageName,ack:req.body?.ack}));
  }));
  router.get('/catalog',asyncHandler(async(req,res)=>{
    const identity=await authenticateKiosk(req);if(!getCatalog)return res.status(503).json({error:'APPROVAL_CATALOG_UNAVAILABLE'});
    const catalog=await getCatalog({...identity,path:typeof req.query.path==='string'?req.query.path:null});
    res.json({activities:(catalog.activities??[]).map(({id,label,path})=>({id,label,path})),learners:(catalog.learners??[]).map(({id,label})=>({id,label})),currentActivityId:catalog.currentActivityId??null});
  }));
  router.post('/requests',asyncHandler(async(req,res)=>{
    const context=await requestContext(req);if(!workflow)return res.status(503).json({error:'APPROVAL_UNAVAILABLE'});
    res.json(await workflow.requestPermission({context,idempotencyKey:req.body?.idempotencyKey}));
  }));
  router.get('/requests/:id',asyncHandler(async(req,res)=>{const context=await requestContext(req);if(!workflow)return res.status(503).json({error:'APPROVAL_UNAVAILABLE'});res.json(await workflow.getRequest({requestId:req.params.id,context}));}));
  for(const [path,method] of [['cancel','cancelRequest'],['end','endSession']])router.post(`/requests/:id/${path}`,asyncHandler(async(req,res)=>{const context=await requestContext(req);if(!workflow)return res.status(503).json({error:'APPROVAL_UNAVAILABLE'});res.json(await workflow[method]({requestId:req.params.id,context}));}));
  router.post('/approval-callback',asyncHandler(async(req,res)=>{
    if(!workflow || !callbackAuthority)return res.status(503).json({error:'APPROVAL_CALLBACK_UNAVAILABLE'});
    const header=req.headers.authorization,credentials=typeof header==='string' && header.startsWith('Bearer ')?header.slice(7):null;
    const proof=await callbackAuthority.authenticate({credentials,actionToken:req.body?.action});logger?.info?.('supervision.callback.authenticated',{requestId:proof.requestId,decision:proof.decision,principalId:proof.actor.id,recipientId:proof.actor.recipientId});res.json(await workflow.decideRequest(proof));
  }));
  router.post('/requests/:id/decision',asyncHandler(async(req,res)=>{
    const actor=requireAdult(await authenticateParent?.(req));if(!workflow)return res.status(503).json({error:'APPROVAL_UNAVAILABLE'});
    logger?.info?.('supervision.parent.decision_requested',{requestId:req.params.id,decision:req.body?.decision,actorId:actor.id});
    res.json(await workflow.decideAuthenticated({requestId:req.params.id,decision:req.body?.decision,actor}));
  }));
  router.post('/requests/:id/consume',asyncHandler(async(req,res)=>{if(!workflow)return res.status(503).json({error:'APPROVAL_UNAVAILABLE'});res.json(await workflow.consumeGrant({requestId:req.params.id,context:await requestContext(req)}));}));
  router.post('/enroll',asyncHandler(async(req,res)=>{
    const actor=requireAdult(await verifyParentCredentials?.(req.body??{},req));
    if(!enrollKiosk)return res.status(503).json({error:'KIOSK_ENROLLMENT_UNAVAILABLE'});
    await enrollKiosk(req,res,actor);res.json({enrolled:true});
  }));
  router.post('/consumer-ack',asyncHandler(async(req,res)=>{const kiosk=await authenticateKiosk(req);await ackConsumer?.(kiosk,req.body);res.json({acknowledged:!!ackConsumer});}));
  router.get('/diagnostics',asyncHandler(async(req,res)=>{requireAdult(await authenticateParent(req));res.json(await getDiagnostics?.());}));
  router.post('/parent-diagnostics',asyncHandler(async(req,res)=>{requireAdult(await verifyParentCredentials?.(req.body??{},req));res.json(await getDiagnostics?.());}));
  router.get('/health',asyncHandler(async(req,res)=>{requireAdult(await authenticateParent(req));res.json(await getHealth?.());}));
  router.get('/bootstrap',asyncHandler(async(req,res)=>{
    res.json(getBootstrap?await getBootstrap(req):{enabled:true,...await authenticateKiosk(req)});
  }));
  router.get('/access',asyncHandler(async(req,res)=>{
    const kiosk=await authenticateKiosk(req);
    const context={deviceId:kiosk.deviceId,clientSessionId:kiosk.sessionId,activityId:typeof req.query.activityId==='string'?req.query.activityId:'',learnerId:req.query.learnerId,requestId:req.query.requestId,sessionId:req.query.sessionId};
    if(req.query.deviceId && req.query.deviceId!==kiosk.deviceId)return res.status(403).json({error:'KIOSK_TARGET_NOT_AUTHORIZED'});
    try{const permit=await guard.authorize(context);res.json({...permit,allowed:true,issuedAt:clock.now()});}
    catch(error){if(error.status!==403)throw error;const state=await service.status({deviceId:kiosk.deviceId});res.json({allowed:false,reason:error.code,epoch:state.epoch});}
  }));
  router.post('/parent-command',asyncHandler(async(req,res)=>{
    const {username,password,action}=req.body??{};
    if(!['stop','release'].includes(action))return res.status(400).json({error:'Invalid parent command'});
    const actor=requireAdult(await verifyParentCredentials?.({username,password},req));
    res.json(await service[action]({actor,scopeId,source:'parent-controls',idempotencyKey:makeId()}));
  }));
  for(const action of ['stop','release'])router.post(`/${action}`,asyncHandler(async(req,res)=>{
    const actor=requireAdult(await authenticateParent(req));
    res.json(await service[action]({actor,scopeId,source:'parent-controls',idempotencyKey:makeId()}));
  }));
  router.get('/status',asyncHandler(async(req,res)=>{
    const context=await authenticateKiosk(req);res.json({...await service.status({deviceId:context.deviceId}),...(getHealth?{enforcement:await getHealth()}:{})});
  }));
  router.post('/identity-context',asyncHandler(async(req,res)=>{
    const context=await authenticateKiosk(req);
    if(req.body.purpose!=='unlock')requireAdult(await authenticateParent(req));
    const reader=identity??getIdentity();
    if(!reader) return res.status(503).json({error:'PARENT_READER_UNAVAILABLE'});
    res.json(reader.beginPurpose({deviceId:context.deviceId,purpose:req.body.purpose}));
  }));
  router.delete('/identity-context/:id',asyncHandler(async(req,res)=>{
    const context=await authenticateKiosk(req);(identity??getIdentity())?.clearPurpose({deviceId:context.deviceId,contextId:req.params.id});res.json({cleared:true});
  }));
  router.use(errorHandlerMiddleware({shape:'string'}));return router;
}

/** Only for installations with no configured or persisted supervision workflow. */
export function createDisabledSupervisionRouter(){const router=express.Router();router.get('/bootstrap',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:false}));return router;}
/** Every supervision route on a backend that is not the ledger writer: loud, never a permit. */
export function createRefusedSupervisionRouter({message,code='SUPERVISION_WRITER_HOST_REFUSED'}){const router=express.Router();router.use((_req,res)=>res.status(503).set('Cache-Control','no-store').json({error:message,code}));return router;}
