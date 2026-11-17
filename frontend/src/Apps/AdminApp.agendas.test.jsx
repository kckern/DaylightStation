import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import AdminApp from './AdminApp.jsx';
it('renders the canonical agenda overview within the Admin shell',async()=>{
 vi.stubGlobal('fetch',vi.fn(async url=>new Response(JSON.stringify(String(url).includes('/agendas')?{series:[]}:{}),{status:200,headers:{'Content-Type':'application/json'}})));
 render(<MemoryRouter initialEntries={['/content/agendas']}><AdminApp/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:'Agendas'})).toBeTruthy();
 expect(screen.getByRole('link',{name:'Agendas'})).toHaveAttribute('href','/admin/content/agendas');
 vi.unstubAllGlobals();
});
it.each([
 ['/content/agendas/s','Series title'],
 ['/content/agendas/s/plans/p','Next week'],
])('renders canonical route %s',async(path,heading)=>{
 const series={series_id:'s',title:'Series title',revision:1,calendar:{timezone:'UTC'},defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const plan={plan_id:'p',series_id:'s',title:'Week',revision:1,week_of:'2026-11-23',scheduled_on:'2026-11-23',calendar:{timezone:'UTC'},state:'draft',participants:[],list:{sections:[]},activity_settings:{}};
 vi.stubGlobal('fetch',vi.fn(async url=>{const path=String(url);let body;if(path.endsWith('/planning-context'))body={thisWeek:'2026-11-16',nextWeek:'2026-11-23'};else if(path.includes('/people'))body={people:[]};else if(path.endsWith('/plans/p'))body=plan;else if(path.endsWith('/plans'))body={plans:[{document:plan,etag:'"p"'}]};else body=series;return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json',ETag:'"1"'}});}));
 render(<MemoryRouter initialEntries={[path]}><AdminApp/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:heading})).toBeTruthy();
 vi.unstubAllGlobals();
});
