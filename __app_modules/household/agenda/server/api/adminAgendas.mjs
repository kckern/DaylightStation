import express from 'express';
import {bodyFields,found,handler,httpError,installed,precondition,sendRecord,viewerFor} from '#api/utils/participantHttp.mjs';

/** The installed household is injected by composition, never supplied by the client. */
export function createAdminAgendasRouter({householdId,planning,logger}={}) {
  const router=express.Router();
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  const route=fn=>handler(logger,async(req,res)=>{
    const viewer=viewerFor(req,householdId,true);
    await fn(req,res,installed(planning),viewer);
  });
  const scope=(req)=>({householdId,seriesId:req.params.seriesId});
  const planScope=async(req,service)=>{
    const args={...scope(req),planId:req.params.planId};
    found(await service.readPlan(args));
    return args;
  };
  const validate=(result)=>{if (!result.valid) throw httpError('invalid_agenda','Invalid document',result.errors);};
  router.get('/',route(async(_req,res,service)=>res.json({series:await service.listSeries({householdId})})));
  router.post('/',route(async(req,res,service)=>{
    const {series}=bodyFields(req.body,['series']);
    if (series?.household_id!==householdId) throw httpError('invalid_request','Invalid household',[{field:'series.household_id',message:'Must match installed household'}]);
    validate(service.validateSeriesDocument(series));
    const result=await service.saveSeries({householdId,seriesId:series.series_id,expectedEtag:null,series});
    logger?.info?.('agenda.series.created',{seriesId:series.series_id});
    sendRecord(res,result,201);
  }));
  router.get('/:seriesId',route(async(req,res,service)=>sendRecord(res,found(await service.readSeries(scope(req))))));
  router.put('/:seriesId',route(async(req,res,service)=>{
    const expectedEtag=precondition(req); const {series}=bodyFields(req.body,['series']);
    if (series?.household_id!==householdId || series?.series_id!==req.params.seriesId) throw httpError('invalid_request','Invalid identity',[{field:'series',message:'Identity must match request scope'}]);
    validate(service.validateSeriesDocument(series));
    const result=await service.saveSeries({...scope(req),expectedEtag,series});
    logger?.info?.('agenda.series.saved',{seriesId:req.params.seriesId}); sendRecord(res,result);
  }));
  router.post('/:seriesId/archive',route(async(req,res,service)=>{bodyFields(req.body ?? {},[]);const expectedEtag=precondition(req);sendRecord(res,await service.archiveSeries({...scope(req),expectedEtag}));}));
  router.get('/:seriesId/plans',route(async(req,res,service)=>{found(await service.readSeries(scope(req)));res.json({plans:await service.listPlans(scope(req))});}));
  router.post('/:seriesId/plans',route(async(req,res,service)=>{
    const body=bodyFields(req.body,['weekOf','requestId','sourcePlanId','sourceRevision']);
    const errors=[];
    if (typeof body.weekOf!=='string' || !body.weekOf) errors.push({field:'weekOf',message:'Week required'});
    if (typeof body.requestId!=='string' || !body.requestId.trim()) errors.push({field:'requestId',message:'Request ID required'});
    if (body.sourcePlanId != null && (typeof body.sourcePlanId!=='string' || !body.sourcePlanId.trim())) errors.push({field:'sourcePlanId',message:'Source plan ID required'});
    if (!Number.isSafeInteger(body.sourceRevision) || body.sourceRevision<0) errors.push({field:'sourceRevision',message:'Source revision required'});
    if (errors.length) throw httpError('invalid_request','Invalid create request',errors);
    const result=await service.createPlan({...scope(req),...body});logger?.info?.('agenda.plan.created',{seriesId:req.params.seriesId,planId:result.document.plan_id});sendRecord(res,result,201);
  }));
  router.get('/:seriesId/plans/:planId',route(async(req,res,service)=>sendRecord(res,found(await service.readPlan({...scope(req),planId:req.params.planId})))));
  router.put('/:seriesId/plans/:planId',route(async(req,res,service,viewer)=>{
    const expectedEtag=precondition(req); const {plan}=bodyFields(req.body,['plan']); const args=await planScope(req,service);
    if (plan?.household_id!==householdId || plan?.series_id!==args.seriesId || plan?.plan_id!==args.planId) throw httpError('invalid_request','Invalid identity',[{field:'plan',message:'Identity must match request scope'}]);
    validate(service.validatePlanDocument(plan));const result=await service.savePlan({...args,expectedEtag,plan,viewer}); logger?.info?.('agenda.plan.saved',{planId:args.planId});sendRecord(res,result);
  }));
  router.post('/:seriesId/plans/:planId/validate',route(async(req,res,service,viewer)=>{
    const {plan}=bodyFields(req.body,['plan']);const args=await planScope(req,service);
    if (plan?.household_id!==householdId || plan?.series_id!==args.seriesId || plan?.plan_id!==args.planId) throw httpError('invalid_request','Invalid identity',[{field:'plan',message:'Identity must match request scope'}]);
    const result=await service.validateDraft({plan,viewer});res.status(result.valid?200:422).json(result);
  }));
  for (const [path,method] of Object.entries({publish:'publishPlan',withdraw:'withdrawPlan',cancel:'cancelPlan',archive:'archivePlan'})) router.post(`/:seriesId/plans/:planId/${path}`,route(async(req,res,service,viewer)=>{
    bodyFields(req.body ?? {},[]); const expectedEtag=precondition(req);const args=await planScope(req,service);const result=await service[method]({...args,expectedEtag,viewer});logger?.info?.('agenda.plan.transition',{planId:args.planId,state:path});sendRecord(res,result);
  }));
  return router;
}
