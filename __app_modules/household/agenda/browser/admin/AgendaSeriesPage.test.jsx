import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AgendaSeriesPage from './AgendaSeriesPage.jsx';
it('creates next week from defaults without changing the current plan',async()=>{
 const series={series_id:'s',title:'Together',revision:3,calendar:{timezone:'UTC'},defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const current={plan_id:'current',week_of:'2026-11-16',state:'published',revision:5};
 const client={series:vi.fn(async()=>({document:series,etag:'"s"'})),plans:vi.fn(async()=>({document:{plans:[{document:current,etag:'"p"'}]}})),planningContext:vi.fn(async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}})),createPlan:vi.fn(async()=>({document:{plan_id:'new'}}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s']}><Routes><Route path="/admin/content/agendas/:seriesId" element={<AgendaSeriesPage client={client}/>}/><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<div>New editor</div>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Create next week'}));
 await waitFor(()=>expect(client.createPlan).toHaveBeenCalledWith('s',expect.objectContaining({weekOf:'2026-11-23',sourceRevision:3})));
 expect(client.createPlan.mock.calls[0][1].sourcePlanId).toBeUndefined();
 expect(current).toEqual({plan_id:'current',week_of:'2026-11-16',state:'published',revision:5});
 expect(await screen.findByText('New editor')).toBeTruthy();
});
it('resolves a date-addressed week to the opaque plan route',async()=>{
 const {AgendaWeekRedirect}=await import('./AgendaWeekRedirect.jsx');
 const client={plans:async()=>({document:{plans:[{document:{plan_id:'opaque',week_of:'2026-11-23'}}]}})};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/weeks/2026-11-23']}><Routes><Route path="/admin/content/agendas/:seriesId/weeks/:weekOf" element={<AgendaWeekRedirect client={client}/>}/><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<div>Canonical plan</div>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findByText('Canonical plan')).toBeTruthy();
});
it('copies the selected saved week only after confirmation',async()=>{
 vi.stubGlobal('confirm',vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true));
 const series={series_id:'s',title:'Together',revision:3,calendar:{timezone:'UTC'},defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const current={plan_id:'current',week_of:'2026-11-16',state:'published',revision:5};
 const client={series:async()=>({document:series,etag:'"s"'}),plans:async()=>({document:{plans:[{document:current}]}}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),createPlan:vi.fn(async()=>({document:{plan_id:'new'}}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s']}><Routes><Route path="/admin/content/agendas/:seriesId" element={<AgendaSeriesPage client={client}/>}/><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<div>Copied editor</div>}/></Routes></MemoryRouter></MantineProvider>);
 const copy=await screen.findByRole('button',{name:'Copy this week'});fireEvent.click(copy);expect(client.createPlan).not.toHaveBeenCalled();fireEvent.click(copy);
 await waitFor(()=>expect(client.createPlan).toHaveBeenCalledWith('s',expect.objectContaining({weekOf:'2026-11-23',sourcePlanId:'current',sourceRevision:5})));expect(await screen.findByText('Copied editor')).toBeTruthy();vi.unstubAllGlobals();
});
