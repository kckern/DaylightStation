import React from 'react';
import {MantineProvider} from '@mantine/core';
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import ListsFolder from './ListsFolder.jsx';
vi.mock('../../../../frontend/src/lib/api.mjs',()=>({DaylightAPI:vi.fn(async()=>{const error=Error('moved');error.body={code:'resource_moved',adminUrl:'/admin/content/agendas/fhe'};throw error;})}));
it('redirects an old list URL to its current owner',async()=>{
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/lists/menus/fhe']}><Routes><Route path="/admin/content/lists/:type/:name" element={<ListsFolder/>}/><Route path="/admin/content/agendas/:id" element={<div>Agenda owner</div>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findByText('Agenda owner')).toBeTruthy();
});
