const instant=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
const id=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const answer=value=>value && typeof value.text==='string' && value.text.length<=4000 && ['voice','typed'].includes(value.via);

/** Validate the causal chain before deriving credit, cooldown, or spacing facts. */
export function validGratitudeEvidence(events,{learnerId=null,studyDay=null}={}) {
  if(!Array.isArray(events))return false;
  let phase='draft',submitted=null,assessment=null,publication=null,retryAt=null;
  const takes=new Map();
  for(const event of events){
    if(!event || typeof event!=='object' || !instant(event.at))return false;
    switch(event.type){
      case 'opened': if(phase==='completed')return false; break;
      case 'take-saved':
        if(!['draft','retry','refused'].includes(phase) || !id(event.takeId) || typeof event.audioRef!=='string' || (learnerId && !event.audioRef.startsWith(learnerId+'/')) || (event.text!==null && typeof event.text!=='string'))return false;
        if(takes.has(event.takeId) && takes.get(event.takeId)!==event.audioRef)return false;
        takes.set(event.takeId,event.audioRef);break;
      case 'draft-saved':
        if(!['draft','retry','refused'].includes(phase) || !answer(event.draft) || (event.draft.audioRef && ![...takes.values()].includes(event.draft.audioRef)))return false;
        break;
      case 'submitted':
        if(!['draft','retry','refused'].includes(phase) || !id(event.attemptId) || !answer(event) || !event.text.trim() || (event.audioRef && ![...takes.values()].includes(event.audioRef)) || (retryAt && Date.parse(event.at)<Date.parse(retryAt)))return false;
        submitted=event;assessment=null;publication=null;retryAt=null;phase='submitted';break;
      case 'assessed':
        if(phase!=='submitted' || !submitted || event.attemptId!==submitted.attemptId || !['eligible','uncertain','nonsense','repetition'].includes(event.verdict) || (event.verdict==='repetition' && typeof event.matchedId!=='string'))return false;
        assessment=event;phase=event.verdict==='uncertain'?'retry':'judged';break;
      case 'refused':
        if(phase!=='judged' || !assessment || !['nonsense','repetition'].includes(assessment.verdict) || event.reason!==assessment.verdict || event.attemptId!==submitted.attemptId || !instant(event.retryAt) || Date.parse(event.retryAt)!==Date.parse(assessment.at)+30*60_000)return false;
        retryAt=event.retryAt;phase='refused';break;
      case 'publication-pending':
        if(phase!=='judged' || assessment?.verdict!=='eligible' || event.attemptId!==submitted.attemptId || event.text!==submitted.text || typeof event.subject!=='string' || !event.subject.trim() || event.subject.length>160 || !instant(event.timestamp) || typeof event.selectionId!=='string')return false;
        if(learnerId && studyDay && event.selectionId!==`school-gratitude:${learnerId}:${studyDay}`)return false;
        publication=event;phase='publishing';break;
      case 'completed':
        if(phase!=='publishing' || !publication || event.attemptId!==submitted.attemptId || event.selectionId!==publication.selectionId)return false;
        phase='completed';break;
      default:return false;
    }
  }
  return true;
}
