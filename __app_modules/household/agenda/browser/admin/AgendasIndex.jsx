import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Alert,Stack,Text,Title} from '@mantine/core';
import {agendaClient} from './agendaClient.js';
export default function AgendasIndex({client=agendaClient}) {
 const [rows,setRows]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;client.seriesList().then(async r=>Promise.all(r.document.series.map(async ({document})=>{if(document.status==='archived') return {document};const [plans,context]=await Promise.all([client.plans(document.series_id),client.planningContext(document.series_id)]);const status=week=>plans.document.plans.find(p=>p.document.week_of===week)?.document.state || 'missing';return {document,thisStatus:status(context.document.thisWeek),nextStatus:status(context.document.nextWeek)};}))).then(value=>active&&setRows(value)).catch(e=>active&&setError(e.message));return()=>{active=false;};},[client]);
 return <Stack><Title order={2}>Agendas</Title>{error&&<Alert color="red">{error}</Alert>}{!rows&&!error&&<Text>Loading agendas…</Text>}{rows?.filter(({document})=>document.status!=='archived').map(({document,thisStatus,nextStatus})=><div key={document.series_id}><Link to={`/admin/content/agendas/${encodeURIComponent(document.series_id)}`}>{document.title}</Link><Text>This week: {thisStatus}</Text><Text>Next week: {nextStatus}</Text></div>)}{rows?.some(({document})=>document.status==='archived')&&<details><summary>Archived agendas</summary>{rows.filter(({document})=>document.status==='archived').map(({document})=><div key={document.series_id}><Link to={`/admin/content/agendas/${encodeURIComponent(document.series_id)}`}>{document.title}</Link></div>)}</details>}</Stack>;
}
