/** Both answers, trimmed, one per line: what is judged, extracted and published after a follow-up. */
export const combineGratitudeAnswers = (first, second) => `${String(first).trim()}\n${String(second).trim()}`;
const instant=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
const id=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const ANSWER_PHASES=['draft','retry','refused','follow-up','steered','warned'];
const MAX_COOLDOWN_MS=30*60_000;
const answer=value=>value && typeof value.text==='string' && value.text.length<=4000 && ['voice','typed'].includes(value.via);

/** Validate the causal chain before deriving credit, cooldown, or spacing facts. */
export function validGratitudeEvidence(events,{learnerId=null,studyDay=null}={}) {
  if(!Array.isArray(events))return false;
  let phase='draft',submitted=null,assessment=null,publication=null,retryAt=null,followUp=null,followUpAsked=false,expectedText=null;
  const takes=new Map();
  for(const event of events){
    if(!event || typeof event!=='object' || !instant(event.at))return false;
    switch(event.type){
      case 'opened': if(phase==='completed')return false; break;
      case 'take-saved':
        if(!ANSWER_PHASES.includes(phase) || !id(event.takeId) || typeof event.audioRef!=='string' || (learnerId && !event.audioRef.startsWith(learnerId+'/')) || (event.text!==null && typeof event.text!=='string'))return false;
        if(takes.has(event.takeId) && takes.get(event.takeId)!==event.audioRef)return false;
        takes.set(event.takeId,event.audioRef);break;
      case 'take-unheard':
        if(!ANSWER_PHASES.includes(phase) || !takes.has(event.takeId) || takes.get(event.takeId)!==event.audioRef)return false;
        break;
      case 'draft-saved':
        if(!ANSWER_PHASES.includes(phase) || !answer(event.draft) || (event.draft.audioRef && ![...takes.values()].includes(event.draft.audioRef)))return false;
        break;
      case 'submitted':
        if(!ANSWER_PHASES.includes(phase) || !id(event.attemptId) || !answer(event) || !event.text.trim() || (event.audioRef && ![...takes.values()].includes(event.audioRef)) || (retryAt && Date.parse(event.at)<Date.parse(retryAt)))return false;
        // A follow-up answer names the general attempt it answers; nothing else may.
        if(event.followUpOf!==undefined && (phase!=='follow-up' || event.followUpOf!==followUp?.attemptId))return false;
        if(phase==='follow-up' && event.followUpOf===undefined)return false;
        expectedText=event.followUpOf!==undefined?combineGratitudeAnswers(followUp.firstText,event.text):event.text;
        followUp=null;submitted=event;assessment=null;publication=null;retryAt=null;phase='submitted';break;
      case 'assessed':
        if(phase!=='submitted' || !submitted || event.attemptId!==submitted.attemptId || !['eligible','uncertain','nonsense','repetition','general','rude'].includes(event.verdict) || (event.verdict==='repetition' && typeof event.matchedId!=='string') || (event.verdict==='general' && followUpAsked))return false;
        assessment=event;phase=event.verdict==='uncertain'?'retry':'judged';break;
      case 'follow-up-asked':
        if(phase!=='judged' || assessment?.verdict!=='general' || event.attemptId!==submitted.attemptId || followUpAsked || typeof event.question!=='string' || event.question.trim().length<8 || event.question.trim().length>140 || !['model','fallback'].includes(event.writer))return false;
        followUp={attemptId:event.attemptId,firstText:submitted.text};followUpAsked=true;phase='follow-up';break;
      case 'refused': {
        // The break's length is recorded on the event (5 minutes on the preschool ladder); 30 minutes when absent.
        const cooldownMs=event.cooldownMs??MAX_COOLDOWN_MS;
        if(!Number.isInteger(cooldownMs) || cooldownMs<=0 || cooldownMs>MAX_COOLDOWN_MS)return false;
        if(phase!=='judged' || !assessment || !['nonsense','repetition','rude'].includes(assessment.verdict) || event.reason!==assessment.verdict || event.attemptId!==submitted.attemptId || !instant(event.retryAt) || Date.parse(event.retryAt)!==Date.parse(assessment.at)+cooldownMs)return false;
        retryAt=event.retryAt;phase='refused';break;
      }
      case 'steered':
        if(phase!=='judged' || !['general','repetition'].includes(assessment?.verdict) || event.reason!==assessment.verdict || event.attemptId!==submitted.attemptId)return false;
        phase='steered';break;
      case 'warned':
        if(phase!=='judged' || assessment?.verdict!=='nonsense' || event.attemptId!==submitted.attemptId)return false;
        phase='warned';break;
      case 'publication-pending':
        if(phase!=='judged' || assessment?.verdict!=='eligible' || event.attemptId!==submitted.attemptId || event.text!==expectedText || typeof event.subject!=='string' || !event.subject.trim() || event.subject.length>160 || !instant(event.timestamp) || typeof event.selectionId!=='string')return false;
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
