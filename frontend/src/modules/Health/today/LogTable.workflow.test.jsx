import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach,it,expect,vi } from 'vitest';
import { LogTable } from './LogTable.jsx';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
vi.mock('../capture/VoiceCapture.jsx',()=>({VoiceCapture:({onCapture,bucket,mealLabel})=><button onClick={()=>onCapture('audio',bucket)}>Speak to {mealLabel}</button>}));
const rows=[{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300},{uuid:'tomato',name:'Tomatoes',mealTime:'evening',calories:20,grams:100}];
const buckets=new Map([['evening',rows]]);
// The meal's mic lives in its add row; this stand-in row mounts the same
// VoiceCapture with the capture its section hands it.
const addRow=(bucket,label,meal)=>meal.onVoiceCapture?<VoiceCapture bucket={bucket} mealLabel={label} onCapture={meal.onVoiceCapture}/>:null;
const renderLog=props=>render(<MantineProvider><LogTable date="2026-09-06" byBucket={buckets} onRowTap={()=>{}} onMealChanged={()=>{}} renderAddRow={addRow} {...props}/></MantineProvider>);
afterEach(()=>{cleanup();vi.useRealTimers();});
it('limits meal voice to selected foods and resolves ambiguity through selectable choices',async()=>{
 const voice=vi.fn(async()=>({instructionText:'the broth had potatoes',clarification:{question:'Which broth?',choices:[{id:'broth',label:'Beef broth'}]}}));
 const text=vi.fn(async()=>({committed:true}));
 renderLog({onVoiceCapture:voice,onTextCapture:text});
 fireEvent.click(screen.getByRole('button',{name:'Select foods'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Beef broth'}));
 fireEvent.click(screen.getByRole('button',{name:'Speak to Dinner'}));
 expect(voice).toHaveBeenCalledWith('audio','evening',{date:'2026-09-06',selectedIds:['broth']});
 fireEvent.click(await screen.findByRole('button',{name:'Beef broth',exact:true}));
 await waitFor(()=>expect(text).toHaveBeenCalledWith('the broth had potatoes','evening',{date:'2026-09-06',selectedIds:['broth'],clarification:'broth'}));
 expect(screen.queryByText('Which broth?')).toBeNull();
});
it('renders independent progress for simultaneous captures',()=>{
 renderLog({captureTasks:[{id:'a',date:'2026-09-06',bucket:'evening',startedAt:Date.now()},{id:'b',date:'2026-09-06',bucket:'evening',startedAt:Date.now()}]});
 expect(screen.getAllByRole('progressbar')).toHaveLength(2);
});
it('a typed sentence in flight shows its own "Adding" row in its meal',()=>{
 renderLog({captureTasks:[{id:'s',date:'2026-09-06',bucket:'evening',startedAt:Date.now(),text:'bowl of chili'}]});
 expect(screen.getByText('Adding “bowl of chili”…')).toBeTruthy();
});
it('marks just-added rows for the highlight',()=>{
 const {container}=renderLog({addedIds:new Set(['tomato'])});
 const lines=[...container.querySelectorAll('.health-row-line--added')];
 expect(lines).toHaveLength(1);
 expect(lines[0].textContent).toContain('Tomatoes');
});
