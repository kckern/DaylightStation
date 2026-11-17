const HOUR=3600000,DAY=24*HOUR;
const instant=value=>typeof value==='number'?value:Date.parse(value);
const rate=(part,total)=>total?part/total:null;
const attributed=response=>response&&response.action!=='skip'&&Number.isFinite(response.at)&&['reply_to','window'].includes(response.attribution);
const acknowledged=ask=>!ask.previewOnly&&ask.botMessageId&&Number.isFinite(ask.deliveredAt)&&['knowledge','legacy'].includes(ask.arm);
function immutableView(snapshot,transactions,asOf) {
  const latest=transactions.filter(t=>t.complete&&t.complete.at<=asOf&&t.prepare?.after?.files).sort((a,b)=>a.complete.at-b.complete.at).at(-1);
  if(!latest)return {objects:snapshot.objects,asks:snapshot.asks,state:snapshot.state,basis:'current-snapshot'};
  const files=latest.prepare.after.files;
  return {objects:Object.fromEntries(Object.values(files).filter(value=>value?.kind==='loop'||value?.kind==='person').map(object=>[object.id,object])),
    asks:Object.entries(files).filter(([name])=>name.startsWith('asks/')).flatMap(([,value])=>value.items??[]),state:files['state.yml']??{},basis:'committed-ledger'};
}
/** Observational counts from acknowledged deliveries and completed transactions. */
export class KnowledgeMetrics {
  #store;#ledger;
  constructor({store,ledger}) {if(!store?.read||!ledger?.read)throw new TypeError('Invalid knowledge metrics dependencies');this.#store=store;this.#ledger=ledger;}
  async report({username,from,to,asOf}) {
    const start=instant(from),end=instant(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(asOf)||end<=start)throw new TypeError('Metrics need an explicit bounded instant range');
    const snapshot=await this.#store.read({username});
    if(!snapshot.health.available)return {available:false,reason:snapshot.health.reason??'unavailable'};
    const history=await this.#ledger.read({username});
    const view=immutableView(snapshot,history.transactions??[],asOf);
    const all=new Map();
    for(const ask of (view.asks??[]).filter(acknowledged)) {
      const key=[ask.arm,ask.channel,ask.objectId,ask.botMessageId].join('|');
      if(!all.has(key)||ask.response)all.set(key,ask);
    }
    const asks=[...all.values()].filter(ask=>ask.deliveredAt<=asOf);
    const cohort=asks.filter(ask=>ask.deliveredAt>=start&&ask.deliveredAt<end);
    const messageReplies=Object.values(view.state?.messageReplies??{}).filter(response=>attributed(response)&&response.at<=asOf);
    const morning=new Map();
    for(const ask of cohort.filter(ask=>ask.channel==='morning'&&asOf-ask.deliveredAt>=12*HOUR)) {
      const key=[ask.arm,ask.askDate,ask.botMessageId].join('|');
      const current=morning.get(key)??{arm:ask.arm,replied:false};
      const response=ask.response;
      if(attributed(response)&&response.at>=ask.deliveredAt&&response.at<=asOf&&response.at-ask.deliveredAt<=12*HOUR)current.replied=true;
      if(messageReplies.some(reply=>reply.channel==='morning'&&reply.arm===ask.arm&&reply.botMessageId===ask.botMessageId&&reply.askDate===ask.askDate&&reply.at>=ask.deliveredAt&&reply.at-ask.deliveredAt<=12*HOUR))current.replied=true;
      morning.set(key,current);
    }
    const replyRate12h=Object.fromEntries(['knowledge','legacy'].map(arm=>{
      const rows=[...morning.values()].filter(row=>row.arm===arm),replied=rows.filter(row=>row.replied).length;
      return [arm,{eligible:rows.length,replied,rate:rate(replied,rows.length)}];
    }));
    const responseMap=new Map();
    for(const ask of cohort.filter(ask=>attributed(ask.response)&&ask.response.at>=ask.deliveredAt&&ask.response.at<=asOf))responseMap.set(ask.response.messageKey??ask.response.receiptId??'ask:'+ask.id,ask.response);
    for(const reply of messageReplies.filter(reply=>reply.deliveredAt>=start&&reply.deliveredAt<end&&reply.at>=reply.deliveredAt))responseMap.set(reply.messageKey??reply.receiptId,reply);
    const responses=[...responseMap.values()];
    const taps=responses.filter(response=>response.by==='tap').length;
    const lengths=responses.filter(response=>['text','voice'].includes(response.by)&&Number.isFinite(response.length)&&response.length>=0).map(response=>response.length).sort((a,b)=>a-b);
    const medianReplyLength=lengths.length?(lengths[Math.floor((lengths.length-1)/2)]+lengths[Math.floor(lengths.length/2)])/2:null;
    const mature=Object.values(view.objects).filter(object=>object.kind==='loop'&&Number.isFinite(object.created?.at)&&object.created.at>=start&&object.created.at<end&&asOf-object.created.at>=14*DAY).map(object=>[object.id,object.created.at]);
    const resolvedAt=object=>object&&['answered','dropped'].includes(object.status)&&Number.isFinite(object.loop?.answer?.at)&&object.loop.answer.at<=asOf?object.loop.answer.at:null;
    const resolved=mature.filter(([id,at])=>{const when=resolvedAt(view.objects[id]);return when!=null&&when>=at&&when-at<=14*DAY;}).length;
    const knowledgeAsks=cohort.filter(ask=>ask.arm==='knowledge'&&ask.objectId);
    const resolutions=new Set(knowledgeAsks.filter(ask=>{const when=resolvedAt(view.objects[ask.objectId]);return when!=null&&when>=ask.deliveredAt;}).map(ask=>ask.objectId)).size;
    const loops=Object.values(view.objects).filter(object=>object.kind==='loop'),stale=loops.filter(object=>object.status==='stale').length;
    const events=new Map();
    for(const transaction of history.transactions??[]) {
      if(!transaction.complete||transaction.complete.at>asOf||transaction.prepare?.batch?.previewOnly)continue;
      for(const event of transaction.prepare?.batch?.events??[])if(event.id&&Number.isFinite(event.at)&&event.at>=start&&event.at<end&&event.at<=asOf)events.set(event.id,event);
    }
    const count=type=>[...events.values()].filter(event=>event.type===type).length;
    const confirmed=count('knowledge.review.confirmed'),rejected=count('knowledge.review.rejected');
    return {available:true,basis:view.basis,from:start,to:end,asOf,replyRate12h,
      tapShare:{taps,replies:responses.length,rate:rate(taps,responses.length)},medianReplyLength,
      resolutionWithin14Days:{eligible:mature.length,resolved,rate:rate(resolved,mature.length)},
      asksPerResolution:{asks:knowledgeAsks.length,resolutions,ratio:resolutions?knowledgeAsks.length/resolutions:null},
      staleRate:{stale,total:loops.length,rate:rate(stale,loops.length)},
      reviewPrecision:{confirmed,rejected,rate:rate(confirmed,confirmed+rejected)},
      dropItCount:responses.filter(response=>response.action==='drop').length,backoffCount:count('knowledge.backoff.started')};
  }
}
