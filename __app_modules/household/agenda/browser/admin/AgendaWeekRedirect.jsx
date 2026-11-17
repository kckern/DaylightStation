import React,{useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {Text} from '@mantine/core';
import {agendaClient} from './agendaClient.js';
export function AgendaWeekRedirect({client=agendaClient}) {
 const {seriesId,weekOf}=useParams(),navigate=useNavigate(),[error,setError]=useState('');
 useEffect(()=>{let active=true;client.plans(seriesId).then(result=>{if(!active)return;const plan=result.document.plans.find(p=>p.document.week_of===weekOf);if(plan)navigate(`/admin/content/agendas/${encodeURIComponent(seriesId)}/plans/${encodeURIComponent(plan.document.plan_id)}`,{replace:true});else setError('No plan exists for this week.');}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[client,navigate,seriesId,weekOf]);
 return <Text>{error||'Resolving week…'} {error&&<Link to={`/admin/content/agendas/${encodeURIComponent(seriesId)}`}>Open series</Link>}</Text>;
}
