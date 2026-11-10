/** Synthetic, loopback-only acceptance host. Production frame, list, menu,
 * governance resolver/engine and overlay retain their actual styles/behavior.
 * The sidebar duplicates FitnessSidebar's slot structure to reserve its real
 * 16:9 media panel without mounting cameras, music or household session APIs.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { MantineProvider } from '@mantine/core';
import Frame from '../../../__app_modules/wellness/fitness/browser/player/frames/FitnessPlayerFrame.jsx';
import Users from '../../../__app_modules/wellness/fitness/browser/player/panels/FitnessUsers.jsx';
import Menu from '../../../__app_modules/wellness/fitness/browser/player/panels/FitnessSidebarMenu.jsx';
import Scrim from '../../../__app_modules/wellness/fitness/browser/player/SidebarMenuScrim.jsx';
import Monitor from '../../../__app_modules/wellness/fitness/browser/player/panels/FitnessGovernance.jsx';
import Overlay from '../../../__app_modules/wellness/fitness/browser/player/overlays/GovernanceStateOverlay.jsx';
import { resolveGovernanceDisplay } from '../../../__app_modules/wellness/fitness/browser/hooks/useGovernanceDisplay.js';
import { GovernanceEngine } from '../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js';
import { ZONE_COLORS } from '../../../__app_modules/wellness/fitness/browser/shared/constants/fitness.js';
import '../../../__app_modules/wellness/fitness/browser/player/FitnessPlayer.scss';
import { cssColorForStrap } from '../../../__app_modules/wellness/fitness/browser/lib/strapColors.js';

const sequence = ['cool','active','warm','hot','fire'].map((id,rank)=>({id,name:id[0].toUpperCase()+id.slice(1),rank,color:ZONE_COLORS[id],threshold:80+rank*30}));
const meta = {map:Object.fromEntries(sequence.map(z=>[z.id,z]))};
const ranks = Object.fromEntries(sequence.map(z=>[z.id,z.rank]));
const media = document.createElement('video');
let now, engine, lastZones, FixtureContext;
function start({count=3,hold=0,target='warm',challenge=true}={}) {
  engine?.reset(); now=100000; window.fixtureEvents=[];
  lastZones=Object.fromEntries(Array.from({length:count},(_,i)=>['rider-'+i,'active']));
  engine = new GovernanceEngine({treasureBox:{awardBonus:()=>({awarded:true})},getVibrationTracker:()=>null,
    getActiveParticipantState:()=>({participants:Object.keys(lastZones),zoneMap:{...lastZones},totalCount:Object.keys(lastZones).length})},{now:()=>now,random:()=>0});
  engine.configure({governed_labels:['cardio'],grace_period_seconds:30,challenge_hold_seconds:hold,
    policies:{default:{base_requirement:[{[challenge?'active':target]:'all'}],challenges:[{interval:[100,100],min_participants:0,selections:[{zone:target,participants:'all',time_allowed:40}]}]}}});
  engine.setMedia({id:'synthetic-workout',labels:['cardio']});
  evaluate(lastZones);
  if(challenge) {
    engine.challengeState.activeChallenge={id:'acceptance-challenge',policyId:'default',type:'zone',status:'pending',zone:target,rule:'all',requiredCount:count,startedAt:now,expiresAt:now+40000,timeLimitSeconds:40,pausedAt:null,pausedRemainingMs:null};
    evaluate(lastZones);
  }
}
function evaluate(zones=lastZones) {
  lastZones=zones;
  engine.evaluate({activeParticipants:Object.keys(zones),userZoneMap:zones,zoneRankMap:ranks,zoneInfoMap:meta.map,totalCount:Object.keys(zones).length});
}
function Host({context,display,showOverlay=false}) {
  const anchor=React.useRef(null);
  const [menu,setMenu]=React.useState(false);
  const close=()=>{window.closedCount=(window.closedCount||0)+1;setMenu(false);};
  const sidebar=<div ref={anchor} className="fitness-sidebar-container">
    <div className="fitness-sidebar-governance"><Monitor /></div>
    <div className="fitness-sidebar-devices"><Users /></div>
    <div className="fitness-sidebar-media"><div className="media-controls-container"><button aria-label="Open settings" onClick={()=>setMenu(true)}>Settings</button><span>Synthetic media reservation</span></div></div>
    {menu&&<><Scrim anchorRef={anchor} onClose={close}/><Menu onClose={close} visibility={{}} onToggleVisibility={()=>{window.toggleCount=(window.toggleCount||0)+1;}}
      playerRef={{current:{getMediaElement:()=>media}}} boostLevel={1} setBoost={()=>{window.boostCount=(window.boostCount||0)+1;}}
      videoVolume={{volume:.5,setVolume:()=>{window.volumeCount=(window.volumeCount||0)+1;}}} activeSessionId="synthetic-session" onEndSession={()=>{window.endCount=(window.endCount||0)+1;}} /></>}
  </div>;
  return <MantineProvider><FixtureContext.Provider value={context}><div style={{height:'100vh',position:'relative'}}>
    <Frame sidebar={sidebar} sidebarWidth={window.innerWidth===1920?300:250} footer={<div id="fixture-footer" style={{height:80}}>Synthetic footer reservation</div>}
      onContentPointerDown={()=>{window.fullscreenCount=(window.fullscreenCount||0)+1;}}>
      <div className="fitness-player-content" style={{height:'100%',position:'relative'}}>{showOverlay&&<Overlay display={display}/>}</div>
    </Frame>
  </div></FixtureContext.Provider></MantineProvider>;
}
export function installIntegration(root, context) {
  FixtureContext=context;
  window.integrationStart=start;
  window.renderIntegration=({count=5,rpm=2,showOverlay=false,zones,advance=0,heartRates={},pedal=false,...options}={})=>{
    if(options.reset || !engine) start({count,...options});
    now+=advance; evaluate(zones);
    const state=engine.state;
    const people=Object.keys(lastZones).map((id,i)=>({id,profileId:id,deviceId:String(101+i),type:'heart_rate',heartRate:Object.hasOwn(heartRates,id)?heartRates[id]:(ranks[lastZones[id]]==null?null:80+ranks[lastZones[id]]*30),name:'Long Participant Name '+i,zoneId:lastZones[id],zoneTrusted:true,rawZoneId:'fire',isActive:true,lastSeen:Date.now()}));
    const displayMap=new Map(people.map(d=>[d.id,{...d,displayName:d.name,avatarSrc:'/fixture.svg',zoneSequence:sequence}]));
    const display=resolveGovernanceDisplay(state,displayMap,meta);
    // Pedal geometry is a presentation-only fixture; runtime cadence OR behavior
    // is independently verified by GovernanceEngine.cadenceFloorEitherOr tests.
    if(pedal) display.rows[0].pedal={rpm:0,targetRpm:30,orZoneLabel:'Active'};
    const context={connected:true,fitnessDevices:new Map(people.map(d=>[d.deviceId,d])),allDevices:people,participantRoster:people,participantsByDevice:Object.fromEntries(people.map(d=>[d.deviceId,d])),activeHeartRateParticipants:people,
      rpmDevices:Array.from({length:rpm},(_,i)=>({deviceId:String(200+i),type:'cadence',cadence:45,isActive:true})),equipmentDevices:[],deviceConfiguration:{hr:{},cadence:{}},equipment:[],users:[],hrColorMap:Object.fromEntries(people.map(d=>[d.deviceId,'purple'])),zones:sequence,zoneProfiles:[],deviceAssignments:[],zoneProgressIndex:new Map(),userCollections:{all:[]},deviceOwnership:{},pressureMatActivities:{},getDisplayName:id=>({displayName:id,source:'fixture'}),fitnessSessionInstance:{getEquipmentUser:()=>null},governanceState:state};
    window.integrationDiagnostics={now,zoneHold:engine.challengeState.activeChallenge?.zoneHold,pausedAt:engine.challengeState.activeChallenge?.pausedAt,pauseReasons:[...engine._timerPauseReasons],lastZones,events:window.fixtureEvents};
    window.integrationState=JSON.parse(JSON.stringify(state));window.integrationDisplay=display;window.integrationPalette=ZONE_COLORS;window.integrationStrapColor=cssColorForStrap('purple');
    flushSync(()=>root.render(<Host context={context} display={display} showOverlay={showOverlay}/>));
    return {state:window.integrationState,display};
  };
}
