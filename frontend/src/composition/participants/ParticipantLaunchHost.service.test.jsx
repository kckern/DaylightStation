import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {YamlAgendaRepository} from '../../../../__app_modules/household/agenda/server/adapters/YamlAgendaRepository.mjs';
import {YamlAgendaLaunchLedger} from '../../../../__app_modules/household/agenda/server/adapters/YamlAgendaLaunchLedger.mjs';
import {ParticipantLaunchService,ParticipantConsumerRegistry} from '../../../../__capabilities/content-catalog/server/participant-launch.mjs';
import {ParticipantLaunchHost} from './ParticipantLaunchHost.jsx';

it('two confirmed hosts reuse one real service and ledger pending execution',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'participant-host-'));
 try {
  const repository=new YamlAgendaRepository({pathForHousehold:()=>dir});
  const store=new YamlAgendaLaunchLedger({repository,pathForHousehold:()=>dir});
  const target={kind:'app',appId:'fake',participantConsumer:{id:'fake',version:1}};
  let release; const gate=new Promise(resolve=>{release=resolve;}); const executions=[];
  const consumer={id:'fake',version:1,targets:[{action:'open',kind:'app',appId:'fake'}],describe:()=>({participantRequirement:'required',minParticipants:1,maxParticipants:3,selectorSupport:['all']}),prepareSetup:async()=>({schema:'participant-prepared-setup/v1',consumer:{id:'fake',version:1},setup:{schema:'fake/v1',data:{}},preview:{schema:'preview/v1',data:{}},artifacts:[],confirmation:'required'}),begin:async({snapshot,executionKey})=>{executions.push(executionKey);await gate;return {schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:snapshot.consumer,snapshot_hash:snapshot.snapshot_hash,participant_context:snapshot.participant_context,output:{schema:'fake/v1',data:{}}};},findResumable:async()=>[],resume:async({receipt})=>receipt.result};
  const registry=new ParticipantConsumerRegistry(); registry.register({consumer});
  const participant={key:'a',participant_id:'anon:p:a',identity:{kind:'anonymous',scope_id:'p',slot_id:'a'},display:{name:'Guest',avatar:null}};
  const source={scope:{provider:'agenda',id:'p',revision:1},roster:[participant],selector:{schema:'participant-selector/v1',mode:'all'},target,action:'open',consumer:{id:'fake',version:1},settings:{}};
  const provider={id:'agenda',authorizeAccess:async()=>({store,scope_key:JSON.stringify(['home','series','plan','item','open'])}),resolve:async()=>source};
  const service=new ParticipantLaunchService({registry,providers:[provider],resolveDirectTarget:async()=>target,logger:{info(){}}});
  const client={inspect:input=>service.inspect({...input,viewer:{}}),begin:input=>service.begin({...input,viewer:{}})};
  const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'};
  const ready=vi.fn(); const view=render(<><ParticipantLaunchHost refValue={ref} action="open" client={client} resolvePreview={()=>()=>null} onReady={ready} onClose={()=>{}} requestIdFactory={()=> 'one'}/><ParticipantLaunchHost refValue={ref} action="open" client={client} resolvePreview={()=>()=>null} onReady={ready} onClose={()=>{}} requestIdFactory={()=> 'two'}/></>);
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Start'})).toHaveLength(2)); const buttons=screen.getAllByRole('button',{name:'Start'}); fireEvent.click(buttons[0]); await waitFor(()=>expect(executions).toHaveLength(1)); fireEvent.click(buttons[1]); await waitFor(()=>expect(executions).toHaveLength(2));
  expect(executions[0]).toBe(executions[1]);
  await act(async()=>{release(); await gate;}); await waitFor(()=>expect(ready).toHaveBeenCalledTimes(2)); view.unmount();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
