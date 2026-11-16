import React, {useEffect,useRef,useState} from 'react';
import {Alert, Badge, Button, Group, Stack, Text, Title} from '@mantine/core';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {agendaClient} from './agendaClient.js';
import AgendaDefaultsEditor from './AgendaDefaultsEditor.jsx';

export default function AgendaSeriesPage({client=agendaClient,editors={}}) {
 const {seriesId}=useParams(),navigate=useNavigate();
 const createIntent=useRef(null);
 const [series,setSeries]=useState(null),[plans,setPlans]=useState([]),[context,setContext]=useState(null),[defaults,setDefaults]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([client.series(seriesId),client.plans(seriesId),client.planningContext(seriesId)]).then(([s,p,c])=>{if(active){setSeries(s);setPlans(p.document.plans);setContext(c.document);}}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[client,seriesId]);
 if(!series||!context)return <Text>{error||'Loading series…'}</Text>;
 const create=async source=>{if(source && !window.confirm(`Copy ${source.week_of} to ${context.nextWeek}? The new week will be a draft.`))return;try{const sourceRevision=source?.revision ?? series.document.revision;const key=JSON.stringify([context.nextWeek,source?.plan_id ?? null,sourceRevision]);if(createIntent.current?.key!==key)createIntent.current={key,requestId:crypto.randomUUID()};const result=await client.createPlan(seriesId,{weekOf:context.nextWeek,requestId:createIntent.current.requestId,sourceRevision,...(source?{sourcePlanId:source.plan_id}:{})});createIntent.current=null;navigate(`/admin/content/agendas/${encodeURIComponent(seriesId)}/plans/${encodeURIComponent(result.document.plan_id)}`);}catch(e){setError(e.message);}};
 const nextExists=plans.some(p=>p.document.week_of===context.nextWeek);
 return <Stack><Title order={2}>{series.document.title}</Title><Text>{series.document.calendar.timezone}</Text>{error&&<Alert color="red">{error}</Alert>}
 <Text>This week ({context.thisWeek}): {plans.find(p=>p.document.week_of===context.thisWeek)?.document.state || 'missing'}</Text><Text>Next week ({context.nextWeek}): {plans.find(p=>p.document.week_of===context.nextWeek)?.document.state || 'missing'}</Text>
 <Group><Button disabled={nextExists || defaults} onClick={()=>create()}>Create next week</Button><Button disabled={defaults} onClick={()=>setDefaults(true)}>Edit defaults</Button></Group>
 {defaults&&<AgendaDefaultsEditor series={series} client={client} editors={editors} onClose={()=>setDefaults(false)} onSaved={value=>{setSeries(value);setDefaults(false);}}/>}
 {!defaults&&<><Title order={3}>Weeks</Title>{plans.slice().sort((a,b)=>a.document.week_of.localeCompare(b.document.week_of)).map(({document:p})=><Group key={p.plan_id}><Link to={`/admin/content/agendas/${encodeURIComponent(seriesId)}/plans/${encodeURIComponent(p.plan_id)}`}>{p.week_of}</Link><Badge>{p.state}</Badge>{p.week_of===context.thisWeek&&<Badge>This week</Badge>}{p.week_of===context.nextWeek&&<Badge>Next week</Badge>}<Button disabled={nextExists} onClick={()=>create(p)}>Copy this week</Button></Group>)}</>}
 </Stack>;
}
