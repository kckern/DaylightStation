const combat = ['laser','bomb','missile','boost'];
const chooseAct = (acts,last) => acts.find(a=>a.status==='open')?.id || acts.find(a=>a.id===last&&a.status!=='locked')?.id || acts.find(a=>a.status!=='locked')?.id || acts[0]?.id;
export function createSkylineControlState({riders=[],acts=[],lastPlayedByRider={}}={}) {
  return { phase:'identity',riders,acts,lastPlayedByRider,riderId:null,actId:null,rosterIndex:0,steady:0,countdown:3,allowed:true,saveStatus:'idle',weaponsEnabled:false,resumeIntent:'new' };
}
export function reduceSkylineControl(current,event) {
  let state={...current},effects=[];
  const effect=(type,extra={})=>effects.push({type,...extra});
  const ready=intent=>{state.phase='ready';state.steady=0;state.countdown=3;state.resumeIntent=intent;effect('choose-act',{actId:state.actId})};
  const identity=()=>{state.phase='identity';state.riderId=null;state.afterSave=null;effect('release-selector')};
  const identify=rider=>{
    if(!rider)return;
    state.riderId=rider.id;state.phase='flights';state.actId=chooseAct(state.acts,state.lastPlayedByRider[rider.id]);
    effect('assign-rider',{riderId:rider.id});state.saveStatus='idle';
  };
  const finish=afterSave=>{state.phase='saving';state.afterSave=afterSave;effect('finalize',{status:'abandoned'})};
  if(event.type==='CONFIG_CHANGED'){
    state={...state,...event.config};
    if(event.resetIdentity)identity();
    if(!state.acts.some(a=>a.id===state.actId))state.actId=chooseAct(state.acts,state.lastPlayedByRider[state.riderId]);
  } else if(event.type==='SELECT_ACT'&&state.phase==='flights') {
    if(state.acts.some(a=>a.id===event.actId)){state.actId=event.actId;effect('choose-act',{actId:event.actId})}
  } else if(event.type==='IDENTIFY') {
    state.selectorId=event.selectorId;state.equipmentId=event.equipmentId;identify(event.rider);
  } else if(event.type==='OPEN_ROSTER') {state.phase='roster';state.rosterIndex=0}
  else if(event.type==='ACCESS_CHANGED'){
    state.allowed=event.allowed;state.accessReason=event.reason;
    if(!event.allowed&&state.riderId&&!['identity','roster','result','saving','save-details'].includes(state.phase)){
      state.phase='denied';effect('suspend');
    }else if(event.allowed&&state.phase==='denied')state.phase='flights';
  } else if(event.type==='SAVE_CHANGED'){
    state.saveStatus=event.status;
    if(event.status==='saving')state.phase='saving';
    if(event.status==='error')state.phase='result';
    if(event.status==='saved'){
      const after=state.afterSave;state.afterSave=null;
      if(after==='identity')identity();else if(after==='restart')ready('new');else if(after==='flights')state.phase='flights';else state.phase='result';
    }
  } else if(event.type==='FLIGHT_CHANGED'){
    state.flight=event.flight;state.weaponsEnabled=event.weaponsEnabled;
    if(event.flight?.phase==='crashed'&&['flight','stall'].includes(state.phase))state.phase='crash';
    else if(event.flight?.stalled&&state.phase==='flight')state.phase='stall';
  } else if(event.type==='TICK'&&['ready','countdown'].includes(state.phase)){
    state.cadence=event.cadence;
    const c=event.cadence,age=event.nowMs-Number(c?.ts);
    const valid=state.allowed&&c?.connected&&!c.transportStalled&&Number.isFinite(c.rpm)&&c.rpm>=30&&Number.isFinite(age)&&age>=-1000&&age<=2500;
    if(!valid){state.phase='ready';state.steady=0;state.countdown=3}
    else if(state.phase==='ready'){
      state.steady+=event.dt;
      if(state.steady>=1.2-1e-9){state.phase='countdown';state.countdown=3}
    }else{
      state.countdown-=event.dt;
      if(state.countdown<=1e-9){state.phase='flight';state.lastPlayedByRider={...state.lastPlayedByRider,[state.riderId]:state.actId};effect(state.resumeIntent==='checkpoint'?'retry-checkpoint':state.resumeIntent==='live'?'resume-flight':'launch',{actId:state.actId,resume:state.resumeIntent==='saved'})}
    }
  } else if(event.type==='PRESS'){
    const i=event.position-1,gesture=event.gesture||'single';
    if(i<0||i>3)return {state:current,effects:[]};
    const selected=state.acts.find(a=>a.id===state.actId);
    if(state.phase==='identity'){
      if(gesture!=='single'){state.phase='roster';state.rosterIndex=0}else identify(state.riders.find(r=>r.position===i+1));
    }else if(state.phase==='roster'){
      if(gesture!=='single')return {state:current,effects:[]};
      if(i<2&&state.riders.length)state.rosterIndex=(state.rosterIndex+(i===0?-1:1)+state.riders.length)%state.riders.length;
      else if(i===2)identity();else if(i===3)identify(state.riders[state.rosterIndex]);
    }else if(state.phase==='flights'){
      if(i<2&&state.acts.length){const index=state.acts.findIndex(a=>a.id===state.actId);state.actId=state.acts[(index+(i===0?-1:1)+state.acts.length)%state.acts.length].id;effect('choose-act',{actId:state.actId})}
      else if(i===2)identity();else if(i===3&&selected?.status!=='locked'&&state.allowed)ready(event.resume?'saved':'new');
      else if(i===3&&selected?.status==='locked')effect('request-act-unlock',{actId:state.actId});
    }else if(state.phase==='ready'){
      if(i===1)identity();else if(i<3)state.phase='flights';
    }else if(state.phase==='countdown'){if(i===2)state.phase='flights'}
    else if(state.phase==='flight'){
      if(gesture==='long'&&i===3&&!state.flight?.stalled){state.phase='menu';effect('pause')}
      else if(gesture==='single'&&state.weaponsEnabled&&!state.flight?.pausedForSensor)effect('combat',{action:combat[i]});
    }else if(state.phase==='menu'){
      if(i===0)ready('live');else if(i===1)effect('toggle-sound');else finish(i===3?'identity':null);
    }else if(state.phase==='crash'){
      if(i===0)ready('checkpoint');else if(i===1)finish('restart');else finish(i===2?'flights':'identity');
    }else if(state.phase==='result'){
      if(state.saveStatus==='error'){if(i===0)effect('retry-save');else if(i===2)state.phase='save-details'}
      else if(state.saveStatus==='saved'){
        if(i===0)ready('new');
        else if(i===1){const index=state.acts.findIndex(a=>a.id===state.actId),next=state.acts[index+1];if(next&&next.status!=='locked'){state.actId=next.id;effect('choose-act',{actId:next.id});ready('new')}else state.phase='flights'}
        else if(i===2)state.phase='flights';else identity();
      }
    }else if(state.phase==='save-details'){if(i===2)state.phase='result'}
    else if(state.phase==='denied'){if(i===0)effect('request-admin');else if(i===2||i===3)identity()}
  }
  if(state.phase!==current.phase)effect('clear-input');
  return {state,effects};
}

export function describeSkylineControls(s){
 const rider=s.riders.find(r=>r.id===s.riderId),act=s.acts.find(a=>a.id===s.actId),f=s.flight||{};
 let choices;
 switch(s.phase){
 case 'identity':choices=[1,2,3,4].map(position=>{const r=s.riders.find(x=>x.position===position);return [r?.name||'Other riders',r?.gestureHint||'Hold: other riders','●',r?.avatarSrc]});break;
 case 'roster':choices=[['Previous','Browse riders','←'],['Next','Browse riders','→'],['Back','Usual rider buttons','×'],['Choose',s.riders[s.rosterIndex]?.name||'No riders','✓']];break;
 case 'flights':choices=[['Previous','Choose flight','←'],['Next','Choose flight','→'],['Change rider',rider?.name,'×'],[act?.status==='locked'?'Locked':'Start',act?.status==='locked'?'Admin unlock':act?.name,'✓']];break;
 case 'ready':choices=[['Flights','Choose another','▦'],['Change rider',rider?.name,'●'],['Back','Return to flights','×'],['Ready','Pedal at least 30 RPM','✓']];break;
 case 'countdown':choices=[['Keep pedaling','','—'],['Keep pedaling','','—'],['Cancel','Return to flights','×'],['Taking off',String(Math.ceil(s.countdown)),'✓']];break;
 case 'flight':choices=[['Laser',s.weaponsEnabled?'Unlimited bursts':'Opens in level 2','ϟ'],['Bomb',s.weaponsEnabled?(f.bombsLeft??5)+' remaining':'Opens in level 2','●'],['Missile',s.weaponsEnabled?(f.missilesLeft??3)+' remaining':'Opens in level 2','➤'],['Lift boost',(s.weaponsEnabled?(f.boostRechargeRemaining>0?Math.ceil(f.boostRechargeRemaining)+'s recharge':'Ready'):'Opens in level 2')+' · Hold: menu','↑']];break;
 case 'menu':choices=[['Resume','Pedal when ready','✓'],['Sound','Toggle on / off','♫'],['End flight','Save this attempt','×'],['Change rider','Save and finish','●']];break;
 case 'crash':choices=[['Retry checkpoint','Same rider & flight','↻'],['Restart level','From the beginning','⟲'],['Flights','Choose another','▦'],['Change rider','Save and finish','●']];break;
 case 'result':{
  const index=s.acts.findIndex(a=>a.id===s.actId),next=s.acts[index+1];
  choices=s.saveStatus==='error'?[['Retry save','Keep this result','↻'],['Saving required','','—'],['Save details','Inspect error','ⓘ'],['Saving required','','—']]:
   [['Replay',act?.name,'↻'],[next&&next.status!=='locked'?'Next level':'Flights',next?.name||'Choose a flight','→'],['Flights','Choose another','▦'],['Change rider','Someone else can fly','●']];break;
 }
 case 'denied':choices=[['Admin unlock','Present admin badge','✓'],['Locked',s.accessReason||'Access required','—'],['Back','Choose rider','×'],['Change rider','Choose another','●']];break;
 case 'save-details':choices=[['Save pending','','—'],['Save pending','','—'],['Back','Return to result','×'],['Save pending','','—']];break;
 default:choices=Array.from({length:4},()=>[s.phase==='stall'?'Stalled':s.phase==='saving'?'Saving…':'Please wait','', '—']);
 }
 return choices.map(([label,hint,icon,avatarSrc],i)=>({position:i+1,action:combat[i],label,hint:hint||'',icon,avatarSrc,
  disabled:['stall','saving','loading'].includes(s.phase)||(s.phase==='result'&&s.saveStatus==='error'&&[1,3].includes(i)),
  reason:s.phase==='stall'?'This attempt will crash':null}));
}
