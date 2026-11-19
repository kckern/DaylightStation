import React, { useCallback, useEffect, useState } from 'react';
import {Link} from 'react-router-dom';
import {Alert,Stack,Text,Title} from '@mantine/core';
import { useRefreshableRead } from '../../../../../frontend/src/lib/hooks/useRefreshableRead.js';
import {agendaClient} from './agendaClient.js';
export default function AgendasIndex({client=agendaClient}) {
 const [rows,setRows]=useState(null),[error,setError]=useState('');
 const read = useCallback(async (isCurrent, signal) => {
   const childReads = [];
   try {
     const { document: { series } } = await client.seriesList({ signal });
     if (!isCurrent()) return;
     const nextRows = await Promise.all(series.map(async ({ document }) => {
       if (document.status === 'archived') return { document };
       const plansRead = client.plans(document.series_id, { signal });
       childReads.push(plansRead);
       const contextRead = client.planningContext(document.series_id, { signal });
       childReads.push(contextRead);
       const [plans, context] = await Promise.all([plansRead, contextRead]);
       const status = week => plans.document.plans.find(plan => plan.document.week_of === week)?.document.state || 'missing';
       return { document, thisStatus: status(context.document.thisWeek), nextStatus: status(context.document.nextWeek) };
     }));
     if (isCurrent()) setRows(nextRows);
   } catch (error) {
     if (isCurrent()) setError(error.message);
     // Keep the scope cancelable while siblings of a failed read are still pending.
     await Promise.allSettled(childReads);
   }
 }, [client]);
 const { reload } = useRefreshableRead(read);
 useEffect(() => { reload(); }, [reload]);
 return <Stack><Title order={2}>Agendas</Title>{error&&<Alert color="red">{error}</Alert>}{!rows&&!error&&<Text>Loading agendas…</Text>}{rows?.filter(({document})=>document.status!=='archived').map(({document,thisStatus,nextStatus})=><div key={document.series_id}><Link to={`/admin/content/agendas/${encodeURIComponent(document.series_id)}`}>{document.title}</Link><Text>This week: {thisStatus}</Text><Text>Next week: {nextStatus}</Text></div>)}{rows?.some(({document})=>document.status==='archived')&&<details><summary>Archived agendas</summary>{rows.filter(({document})=>document.status==='archived').map(({document})=><div key={document.series_id}><Link to={`/admin/content/agendas/${encodeURIComponent(document.series_id)}`}>{document.title}</Link></div>)}</details>}</Stack>;
}
