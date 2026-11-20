import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { TouchButton } from '../../../../../../frontend/src/lib/ui/index.js';
import { SchoolButton } from '../../portal/SchoolButton.jsx';
import Icon from '../../home/icons/Icon.jsx';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import ReflectionResponse from '../shared/ReflectionResponse.jsx';
import PreschoolGratitude from './PreschoolGratitude.jsx';
import ProgramRetryButton from '../shared/ProgramRetryButton.jsx';
import { useProgramKeys } from '../shared/useProgramKeys.js';
import { useInputStall } from '../shared/useInputStall.js';
import { useGratitudeApi } from '../../runtime/useSchoolFeatureApi.js';
import { gratitudeLog } from './gratitudeLog.js';
import './GratitudeProgram.scss';
const IDLE_THRESHOLDS=[45_000,120_000,300_000];
// Phases in which the answer box is open and a draft may be saved.
// `steered`/`warned` come from the preschool ladder; if a learner leaves preschool mode they read as a retry.
const ANSWER_PHASES=new Set(['draft','not-started','retry','follow-up','steered','warned']);

export default function GratitudeProgram({learnerId,learnerName=null,gratitudeGrant,today,onExit}){
  const api=useGratitudeApi({learnerId,grant:gratitudeGrant});
  const [view,setView]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null),[now,setNow]=useState(Date.now());
  const live=useRef(true),sending=useRef(false),lastBody=useRef(null),clockOffset=useRef(0),expiryCheck=useRef(null);
  const takeIds=useRef(new WeakMap());
  // Set inside `apply`, before React re-renders, so a blur from the last answer
  // render (as the screen switches to "Thank you!") sees the finished phase.
  const phaseRef=useRef(null);
  const apply=useCallback(result=>{
    if(!live.current)return false;
    if(result?.ok){phaseRef.current=result.data.phase;setView(result.data);clockOffset.current=Date.now()-Date.parse(result.data.serverNow);setError(null);return true;}
    setError(result?.data?.error??'Your answer could not be sent. Please try again.');return false;
  },[]);
  const open=useCallback(async()=>{setBusy(true);try{apply(await api.open(today));}finally{if(live.current)setBusy(false);}},[api,today,apply]);
  useEffect(()=>{live.current=true;gratitudeLog.mounted({learnerId});if(gratitudeGrant&&today)open();return()=>{live.current=false;gratitudeLog.unmounted({learnerId});};},[open,gratitudeGrant,today,learnerId]);
  // A preschool break ends in a fresh Ask on this screen, so being idle through it never closes the program.
  const waitingOutBreak=view?.mode==='preschool'&&view?.phase==='cooldown';
  useInputStall(view?.phase??'start',ms=>{gratitudeLog.stall({ms});if(ms>=5*60_000)onExit?.();},{enabled:Boolean(gratitudeGrant)&&!waitingOutBreak,thresholds:IDLE_THRESHOLDS});
  // Once per follow-up attempt; the question and the child's words stay out of the log.
  useEffect(()=>{if(view?.phase==='follow-up')gratitudeLog.followUpShown({promptId:'gratitude-follow-up'});},[view?.phase,view?.attemptId]);
  const remaining=view?.retryAt?Math.max(0,Date.parse(view.retryAt)-(now-clockOffset.current)):0;
  useEffect(()=>{if(view?.phase!=='cooldown')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[view?.phase]);
  useEffect(()=>{if(view?.phase==='cooldown'&&remaining===0&&expiryCheck.current!==view.retryAt){expiryCheck.current=view.retryAt;open();}},[view?.phase,view?.retryAt,remaining,open]);
  const take=useCallback(async blob=>{
    if(!takeIds.current.has(blob))takeIds.current.set(blob,crypto.randomUUID());
    const result=await api.take(view.studyDay,blob,takeIds.current.get(blob));
    if(!result.ok){if(result.status===429)apply(await api.day(view.studyDay));throw new Error(result.data?.error??'Recording failed');}
    takeIds.current.delete(blob);return result.data;
  },[api,view?.studyDay,apply]);
  const retryTake=async()=>{const result=await api.take(view.studyDay,new Blob([],{type:'audio/webm'}),view.draft?.takeId);if(!result.ok)throw new Error('Recording retry failed');return result.data;};
  const submit=async answer=>{
    if(sending.current)return;sending.current=true;setBusy(true);
    const signature=JSON.stringify(answer);
    if(lastBody.current?.signature!==signature)lastBody.current={signature,body:{...answer,attemptId:crypto.randomUUID()}};
    try{
      const result=await api.submit(view.studyDay,lastBody.current.body);
      if(apply(result)&&result.data.phase!=='pending')lastBody.current=null;
      if(result.status===429)apply(await api.day(view.studyDay));
      // A stale tab (e.g. a follow-up asked in another tab) moves to the current phase, then says why.
      if(result.status===409){lastBody.current=null;const message=result.data?.error??null;if(apply(await api.day(view.studyDay))&&message&&live.current)setError(message);}
    }
    finally{sending.current=false;if(live.current)setBusy(false);}
  };
  const retry=async()=>{if(sending.current)return;sending.current=true;setBusy(true);try{const result=await api.retry(view.studyDay,{attemptId:view.attemptId});if(apply(result)&&result.data.phase!=='pending')lastBody.current=null;if(result.ok&&result.data.phase==='completed'&&view.studyDay!==today)await open();}finally{sending.current=false;if(live.current)setBusy(false);}};
  const saveDraft=async body=>{if(sending.current||!ANSWER_PHASES.has(phaseRef.current))return;await api.draft(view.studyDay,body);};
  const close=()=>{gratitudeLog.closed({phase:view?.phase??null});onExit?.();};
  // Preschool screens ignore the keyboard: only the big buttons do anything.
  useProgramKeys({arrowleft:close,...(view?.phase==='completed'?{enter:onExit}:{})},{enabled:view?.mode!=='preschool'});
  if(!gratitudeGrant||!learnerId)return <section className="gratitude-program"><p>Open Gratitude from your School agenda.</p><TouchButton onClick={onExit}>Back to School</TouchButton></section>;
  // A preschooler gets the picture-and-voice screens; the server decides the mode.
  if(view?.mode==='preschool')return <PreschoolGratitude view={view} learnerId={learnerId} learnerName={learnerName} busy={busy} error={error} onDismissError={()=>{setError(null);open();}} remaining={remaining} onTake={take} onSubmit={submit} onRetry={retry} onClose={close}/>;
  return <section className="gratitude-program">
    <header className="gratitude-program__header"><h1>Gratitude</h1><span className="gratitude-program__learner"><ProfileAvatar id={learnerId} name={learnerName??learnerId} size={160}/><span>{learnerName??learnerId}</span></span><SchoolButton variant="plain" type="button" className="gratitude-program__close" aria-label="Close" onClick={close}><Icon name="close"/></SchoolButton></header>
    {error&&<p role="alert">{error}</p>}
    {!view&&<>{!error&&<p role="status">Opening Gratitude…</p>}{error&&<ProgramRetryButton onRetry={open}/>}</>}
    {view&&['draft','not-started','retry','steered','warned'].includes(view.phase)&&<>
      {view.reason==='unclear'&&<p role="status">Please make your gratitude a little clearer and try again.</p>}
      <ReflectionResponse key={`${view.studyDay}:${view.attemptId??'new'}`} prompt={view.prompt} initial={view.draft?.text??''} initialAudioRef={view.draft?.audioRef??null} initialVia={view.draft?.via??null} initialEdited={view.draft?.edited??false} busy={busy} onDraft={saveDraft} onTake={take} onRetryTake={view.draft?.takeId?retryTake:undefined} onSubmit={submit} submitLabel="Submit" events={gratitudeLog} focusOnOpen={false} focusAfterTake={false} transcribingLabel="Writing down what you said…" afterTakeHint="Check your words, then tap Submit." replaceOnTake/>
    </>}
    {view?.phase==='follow-up'&&view.followUp&&<>
      <p className="gratitude-program__first" id={`gratitude-first-${view.attemptId}`}>You said: “{view.followUp.firstText}”</p>
      <ReflectionResponse key={`${view.studyDay}:follow-up:${view.attemptId}`} prompt={{id:'gratitude-follow-up',text:view.followUp.question,required:true}} describedBy={`gratitude-first-${view.attemptId}`} initial={view.draft?.text??''} initialAudioRef={view.draft?.audioRef??null} initialVia={view.draft?.via??null} initialEdited={view.draft?.edited??false} busy={busy} onDraft={saveDraft} onTake={take} onRetryTake={view.draft?.takeId?retryTake:undefined} onSubmit={answer=>submit({...answer,followUpOf:view.attemptId})} submitLabel="Submit" events={gratitudeLog} focusOnOpen={false} focusAfterTake={false} transcribingLabel="Writing down what you said…" afterTakeHint="Check your words, then tap Submit." replaceOnTake/>
    </>}
    {view?.phase==='cooldown'&&<div className="gratitude-program__message" role="status"><h2>Take a little break</h2><p>{view.reason==='repetition'?'You already used that gratitude topic recently. Think of something different.':'Please take some time to think of something you are grateful for.'}</p><p>Try again in {Math.max(1,Math.ceil(remaining/60000))} minutes.</p></div>}
    {['pending','assessing'].includes(view?.phase)&&<div className="gratitude-program__message"><p role="status">Your answer is saved and waiting to be processed.</p><TouchButton disabled={busy} onClick={retry}>Try saved answer again</TouchButton></div>}
    {view?.phase==='completed'&&<div className="gratitude-program__message"><h2>Thank you!</h2><p>Your gratitude is saved.</p><p className="gratitude-program__subject">{view.subject}</p><p>Gratitude complete for today.</p></div>}
    {busy&&<p role="status">Saving your answer…</p>}
  </section>;
}
