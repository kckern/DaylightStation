import express from 'express';
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0,10) === day;

export function createSchoolGratitudeRouter({service,grants,teacherGate,audioStore,logger={}}){
  const router=express.Router();
  const failure=(res,error)=>{
    const status=Number.isInteger(error.status)?error.status:500;
    if(status>=500)logger.warn?.('school.gratitude.route-failed',{error:error.message});
    if(error.retryAt)res.set('Retry-After',String(Math.max(1,Math.ceil((Date.parse(error.retryAt)-Date.now())/1000))));
    return res.status(status).json({error:status>=500?'Your answer could not be processed. Please try again.':error.message,...(error.retryAt?{retryAt:error.retryAt}:{})});
  };
  const wrap=fn=>async(req,res)=>{try{res.json(await fn(req,res));}catch(error){failure(res,error);}};
  const guard=(req,res,next)=>{
    if(!/^[a-z0-9][a-z0-9_-]*$/i.test(req.params.learnerId)||!validDay(req.params.day)){return res.status(400).json({error:'Invalid learner or study day.'});}
    if(!grants?.verify(req.get('X-School-Gratitude-Grant'),{learnerId:req.params.learnerId,day:req.params.day})?.ok)return res.status(403).json({error:'Please open Gratitude from School again.'});
    next();
  };
  const teacher=(req,res,next)=>{try{teacherGate.assert({userId:req.query.by??null,action:'school.gratitude.read',context:{learnerId:req.params.learnerId}});next();}catch{res.status(403).json({error:'Teacher access required.'});}};
  router.get('/teacher/:learnerId/history',teacher,wrap(req=>service.history(req.params.learnerId)));
  router.get('/teacher/:learnerId/audio/:file',teacher,(req,res)=>{const result=audioStore?.read(req.params.learnerId,req.params.file);if(!result)return res.status(404).end();res.type(result.mimeType).send(result.buffer);});
  const base='/:learnerId/day/:day';
  router.get(base,guard,wrap(req=>service.day(req.params.learnerId,req.params.day)));
  router.post(`${base}/open`,guard,wrap(req=>service.open(req.params.learnerId,req.params.day)));
  router.post(`${base}/take`,guard,async(req,res,next)=>{try{await service.assertCanTake(req.params.learnerId,req.params.day);next();}catch(error){failure(res,error);}},express.raw({type:'audio/*',limit:10*1024*1024}),wrap(req=>service.take(req.params.learnerId,req.params.day,{takeId:req.get('X-School-Take-Id'),buffer:req.body,mimeType:req.get('Content-Type')})));
  for(const [path,method]of [['draft','saveDraft'],['submit','submit'],['retry','retry']])router.post(`${base}/${path}`,guard,express.json({limit:'32kb'}),wrap(req=>service[method](req.params.learnerId,req.params.day,req.body??{})));
  router.use((error,req,res,next)=>failure(res,error));
  return router;
}
