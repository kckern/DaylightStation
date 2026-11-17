import express from 'express';
import {bodyFields,handler,httpError,installed,precondition,viewerFor} from '#api/utils/participantHttp.mjs';

export function createPeopleRouter({householdId,directory,logger}={}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  const route=(host,fn)=>handler(logger,async(req,res)=>{viewerFor(req,householdId,host);await fn(req,res,installed(directory));});
  const revision=req=>{const value=precondition(req);if (!/^"(?:0|[1-9]\d*)"$/.test(value)) throw httpError('invalid_request','Invalid revision',[{field:'If-Match',message:'Revision ETag required'}]);const number=Number(value.slice(1,-1));if (!Number.isSafeInteger(number)) throw httpError('invalid_request','Invalid revision',[{field:'If-Match',message:'Revision ETag required'}]);return number;};
  router.get('/',route(true,async(req,res,service)=>{
    const entries=await service.list({householdId,query:req.query.q ?? '',includeArchived:req.query.includeArchived==='true'});
    res.set('ETag',`"${await service.revision({householdId})}"`).json({people:entries});
  }));
  const identity=(result,id)=>{const guest=result.guests.find(entry=>entry.id===id);return {person:{kind:'guest',id:guest.id},display:{name:guest.name,avatar:guest.avatar ?? null},active:guest.active};};
  router.post('/guests',route(true,async(req,res,service)=>{
    const expectedRevision=revision(req);const input=bodyFields(req.body,['id','name','avatar']);
    const result=await service.createGuest({householdId,input,expectedRevision});const entry=identity(result,input.id);
    logger?.info?.('people.guest.created',{guestId:input.id});res.set('ETag',`"${result.revision}"`).status(201).json(entry);
  }));
  router.put('/guests/:id',route(true,async(req,res,service)=>{
    const expectedRevision=revision(req);const input=bodyFields(req.body,['name','avatar']);const result=await service.updateGuest({householdId,id:req.params.id,input,expectedRevision});const entry=identity(result,req.params.id);
    logger?.info?.('people.guest.saved',{guestId:req.params.id});res.set('ETag',`"${result.revision}"`).json(entry);
  }));
  router.post('/guests/:id/archive',route(true,async(req,res,service)=>{
    const expectedRevision=revision(req);bodyFields(req.body ?? {},[]);const result=await service.archiveGuest({householdId,id:req.params.id,expectedRevision});const entry=identity(result,req.params.id);
    logger?.info?.('people.guest.archived',{guestId:req.params.id});res.set('ETag',`"${result.revision}"`).json(entry);
  }));
  return router;
}
