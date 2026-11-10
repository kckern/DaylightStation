import { useState } from 'react';
import { it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HealthOperationsProvider, useHealthOperations } from '../operations/HealthOperationsProvider.jsx';
import { PortionContext, usePortionDraft } from './usePortionDraft.js';
import { EntryRow } from './EntryRow.jsx';
import { EntryEditor } from './EntryEditor.jsx';
const date='2026-10-25';
const rows=[{uuid:'a',name:'Apple',date,mealTime:'morning',kind:'item',grams:100,calories:50,version:1},{uuid:'b',name:'Banana',date,mealTime:'morning',kind:'item',grams:100,calories:90,version:1}];
function Harness(){
 const session=useHealthOperations();
 const [open,setOpen]=useState(true);
 const drafts=usePortionDraft({items:rows,budget:null,reload:()=>{}},date);
 return <PortionContext.Provider value={drafts.control}>
 <button onClick={()=>session.store.begin({id:'save-a',targetIds:['a'],phase:'pending'})}>Save Apple</button>
 {rows.map(row=><EntryRow key={row.uuid} row={row} onTap={()=>{}}/>)}
 <EntryEditor open={open} row={rows[0]} onChanged={()=>{}} onClose={()=>setOpen(false)}/>
 </PortionContext.Provider>;
}
it('locks only the affected row and an already open editor while another row stays usable',async()=>{
 const send=vi.fn(async()=>({items:[]}));
 render(<MantineProvider><HealthOperationsProvider userId="u" send={send}><Harness/></HealthOperationsProvider></MantineProvider>);
 fireEvent.click(screen.getByText('Save Apple'));
 expect(screen.getByRole('button',{name:'Edit Apple'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'Edit Banana'}).disabled).toBe(false);
 expect(screen.getByRole('textbox',{name:'Name'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'Save',exact:true}).disabled).toBe(true);
});

it('returns to the log immediately after submitting an editor save, leaving only that row locked',async()=>{
 let finish;
 const send=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 render(<MantineProvider><HealthOperationsProvider userId="u" send={send}><Harness/></HealthOperationsProvider></MantineProvider>);
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Green apple'}});
 fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
 expect(screen.queryByRole('textbox',{name:'Name'})).toBeNull();
 expect(screen.getByRole('button',{name:'Edit Apple'}).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'Edit Banana'}).disabled).toBe(false);
 await act(async()=>finish({data:{...rows[0],version:2,name:'Green apple'}}));
});
