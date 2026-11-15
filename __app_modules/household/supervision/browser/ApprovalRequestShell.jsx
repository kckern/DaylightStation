import React from 'react';
const messages={idle:'Ask a parent before starting.',pending:'Waiting for a parent…',approved:'Permission approved.',denied:'Permission was declined.',expired:'The request expired.',cancelled:'Request cancelled.',revoked:'Permission is no longer available.'};
export function ApprovalRequestShell({context={},activities=[],learners=[],approval={},onLearnerChange,onActivityChange,parentControls}){
  const {status='idle',busy,error,session}=approval,selected=activities.some(activity=>activity.id===context.activityId);
  return <section className="supervision-boundary" aria-label="Permission required">
    {parentControls}<h1>Ask permission</h1>
    <label>Who is playing?<select aria-label="Learner" value={context.learnerId??''} disabled={busy || status==='pending'} onChange={event=>onLearnerChange?.(event.target.value)}><option value="">Choose your name</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.label}</option>)}</select></label>
    <label>Activity<select aria-label="Activity" value={selected?context.activityId:''} disabled={busy || status==='pending'} onChange={event=>onActivityChange?.(event.target.value)}><option value="">Choose an activity</option>{activities.map(activity=><option key={activity.id} value={activity.id}>{activity.label}</option>)}</select></label>
    <p role="status">{session?'Checking access…':messages[status]??'Checking permission…'}</p>
    {!activities.length && <p>No activities are available on this screen. Ask a parent for help.</p>}
    {error && <p role="alert">{error}</p>}
    {status==='approved'?<button type="button" disabled={busy || !!session} onClick={()=>void approval.startSession?.()}>Start activity</button>:<button type="button" disabled={busy || status==='pending' || !selected || !context.learnerId} onClick={()=>void approval.requestPermission?.()}>Request permission</button>}
    {status==='pending' && <button type="button" disabled={busy} onClick={()=>void approval.cancelRequest?.()}>Cancel request</button>}
  </section>;
}
