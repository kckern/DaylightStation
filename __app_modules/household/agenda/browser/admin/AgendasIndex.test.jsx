import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {MemoryRouter} from 'react-router-dom';
import AgendasIndex from './AgendasIndex.jsx';
it('shows series and current and next planning statuses',async()=>{
 const client={seriesList:vi.fn(async()=>({document:{series:[{document:{series_id:'s',title:'Together'}}]}})),plans:vi.fn(async()=>({document:{plans:[{document:{week_of:'2026-11-16',state:'published'}}]}})),planningContext:vi.fn(async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}))};
 render(<MantineProvider><MemoryRouter><AgendasIndex client={client}/></MemoryRouter></MantineProvider>);
 expect(await screen.findByRole('link',{name:'Together'})).toHaveAttribute('href','/admin/content/agendas/s');
 expect(screen.getByText(/This week: published/)).toBeTruthy();expect(screen.getByText(/Next week: missing/)).toBeTruthy();
});
it('keeps archived series in collapsed accessible history while showing active series normally',async()=>{
 const client={seriesList:vi.fn(async()=>({document:{series:[{document:{series_id:'active',title:'Active',status:'active'}},{document:{series_id:'old',title:'Old',status:'archived'}}]}})),plans:vi.fn(async()=>({document:{plans:[]}})),planningContext:vi.fn(async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}))};
 render(<MantineProvider><MemoryRouter><AgendasIndex client={client}/></MemoryRouter></MantineProvider>);
 expect(await screen.findByRole('link',{name:'Active'})).toBeVisible();
 const history=screen.getByText('Archived agendas');expect(history.tagName).toBe('SUMMARY');expect(history.parentElement).not.toHaveAttribute('open');
 expect(history.parentElement.querySelector('a')).toHaveAttribute('href','/admin/content/agendas/old');
 history.focus();expect(history).toHaveFocus();history.click();
 expect(screen.getByRole('link',{name:'Old'})).toHaveAttribute('href','/admin/content/agendas/old');
 expect(history.parentElement).toHaveAttribute('open');expect(client.plans).toHaveBeenCalledTimes(1);expect(client.plans).toHaveBeenCalledWith('active');
});
