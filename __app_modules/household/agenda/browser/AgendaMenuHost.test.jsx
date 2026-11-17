import React from 'react';
import {render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {AgendaMenuHost} from './AgendaMenuHost.jsx';
vi.mock('../../../media/media/browser/menu.mjs',()=>({default:({rootMenu})=><div>{rootMenu.title}</div>}));
it('fetches the dated menu with the participant protocol and established auth',async()=>{
 localStorage.setItem('ds_token','token');
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'agenda:series/plans/p',title:'Dated plan',items:[]})});
 render(<AgendaMenuHost contentId="agenda:series/current" fetcher={fetcher}/>);
 expect(await screen.findByText('Dated plan')).toBeTruthy();
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/v1/list/agenda/series/current',expect.objectContaining({headers:expect.objectContaining({'X-Daylight-Participant-Launch-Version':'1',Authorization:'Bearer token'})})));
 localStorage.removeItem('ds_token');
});

it('ignores a stale load when the requested content changes',async()=>{
 let resolveOld;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce({ok:true,json:async()=>({id:'agenda:s/plans/new',title:'New',items:[]})});
 const view=render(<AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher}/>);
 view.rerender(<AgendaMenuHost contentId="agenda:s/plans/new" fetcher={fetcher}/>);
 expect(await screen.findByText('New')).toBeTruthy();
 resolveOld({ok:true,json:async()=>({id:'agenda:s/plans/old',title:'Old',items:[]})});
 await waitFor(()=>expect(screen.queryByText('Old')).toBeNull());
 expect(screen.getByText('New')).toBeTruthy();
});
