import React, {useEffect,useRef,useState} from 'react';
import {Alert, Badge, Button, Group, Stack, Text, Title} from '@mantine/core';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {agendaClient} from './agendaClient.js';
import AgendaDefaultsEditor from './AgendaDefaultsEditor.jsx';

export default function AgendaSeriesPage({client=agendaClient,editors={}}) {
  const {seriesId}=useParams();
  const navigate=useNavigate();
  const scope=useRef({id:seriesId,generation:0});
  if (scope.current.id!==seriesId) scope.current={id:seriesId,generation:scope.current.generation+1};
  const generation=scope.current.generation;
  const createIntent=useRef(null);
  const pendingCreate=useRef(null);
  const mounted=useRef(true);
  const [data,setData]=useState(null);
  const [defaultsScope,setDefaultsScope]=useState(null);
  const [busyScope,setBusyScope]=useState(null);
  const [failure,setFailure]=useState(null);
  const isCurrent=token=>mounted.current && scope.current.id===token.id && scope.current.generation===token.generation;

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;
    const token={id:seriesId,generation};
    Promise.all([client.series(seriesId),client.plans(seriesId),client.planningContext(seriesId)])
      .then(([series,plans,context])=>{
        if (active && isCurrent(token)) setData({token,series,plans:plans.document.plans,context:context.document});
      })
      .catch(error=>{if (active && isCurrent(token)) setFailure({token,message:error.message});});
    return ()=>{active=false;};
  },[client,seriesId,generation]);

  if (!data || data.token.id!==seriesId || data.token.generation!==generation) {
    const error=failure?.token.id===seriesId && failure.token.generation===generation ? failure.message : '';
    return <Text>{error || 'Loading series…'}</Text>;
  }
  const {series,plans,context}=data;
  const defaultsOpen=defaultsScope?.id===seriesId && defaultsScope.generation===generation;
  const currentExists=plans.some(plan=>plan.document.week_of===context.thisWeek);
  const nextExists=plans.some(plan=>plan.document.week_of===context.nextWeek);
  const creating=busyScope?.id===seriesId && busyScope.generation===generation;

  const create=async (week,source)=>{
    const token={id:seriesId,generation};
    if (creating || pendingCreate.current?.generation===generation) return;
    if (source && !window.confirm(`Copy ${source.week_of} to ${week}? The new week will be a draft.`)) return;
    const sourceRevision=source?.revision ?? series.document.revision;
    const key=JSON.stringify([seriesId,generation,week,source?.plan_id ?? null,sourceRevision]);
    if (createIntent.current?.key!==key) createIntent.current={key,requestId:crypto.randomUUID()};
    const operation={...token};
    pendingCreate.current=operation;
    setBusyScope(token);
    try {
      const result=await client.createPlan(seriesId,{weekOf:week,requestId:createIntent.current.requestId,sourceRevision,...(source?{sourcePlanId:source.plan_id}:{})});
      if (!isCurrent(token) || pendingCreate.current!==operation) return;
      createIntent.current=null;
      navigate(`/admin/content/agendas/${encodeURIComponent(seriesId)}/plans/${encodeURIComponent(result.document.plan_id)}`);
    } catch (error) {
      if (isCurrent(token) && pendingCreate.current===operation) setFailure({token,message:error.message});
    } finally {
      if (pendingCreate.current===operation) {
        pendingCreate.current=null;
        if (isCurrent(token)) setBusyScope(null);
      }
    }
  };
  const failureMessage=failure?.token.id===seriesId && failure.token.generation===generation ? failure.message : '';
  return <Stack>
    <Title order={2}>{series.document.title}</Title><Text>{series.document.calendar.timezone}</Text>
    {failureMessage && <Alert color="red">{failureMessage}</Alert>}
    <Text>This week ({context.thisWeek}): {plans.find(p=>p.document.week_of===context.thisWeek)?.document.state || 'missing'}</Text>
    <Text>Next week ({context.nextWeek}): {plans.find(p=>p.document.week_of===context.nextWeek)?.document.state || 'missing'}</Text>
    <Group><Button disabled={currentExists || defaultsOpen || creating} onClick={()=>create(context.thisWeek)}>Create this week</Button><Button disabled={nextExists || defaultsOpen || creating} onClick={()=>create(context.nextWeek)}>Create next week</Button><Button disabled={defaultsOpen || creating} onClick={()=>setDefaultsScope({id:seriesId,generation})}>Edit defaults</Button></Group>
    {defaultsOpen && <AgendaDefaultsEditor key={`${seriesId}:${generation}`} series={series} client={client} editors={editors}
      onClose={()=>{if(isCurrent({id:seriesId,generation})) setDefaultsScope(null);}}
      onSaved={value=>{if(isCurrent({id:seriesId,generation})){setData(previous=>({...previous,series:value}));setDefaultsScope(null);}}}/>}
    {!defaultsOpen && <><Title order={3}>Weeks</Title>{plans.slice().sort((a,b)=>a.document.week_of.localeCompare(b.document.week_of)).map(({document:plan})=><Group key={plan.plan_id}>
      <Link to={`/admin/content/agendas/${encodeURIComponent(seriesId)}/plans/${encodeURIComponent(plan.plan_id)}`}>{plan.week_of}</Link><Badge>{plan.state}</Badge>
      {plan.week_of===context.thisWeek && <Badge>This week</Badge>}{plan.week_of===context.nextWeek && <Badge>Next week</Badge>}
      <Button disabled={nextExists || creating} onClick={()=>create(context.nextWeek,plan)}>Copy this week</Button>
    </Group>)}</>}
  </Stack>;
}
