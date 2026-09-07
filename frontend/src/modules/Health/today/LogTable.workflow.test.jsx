import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach,it,expect,vi } from 'vitest';
import { LogTable } from './LogTable.jsx';
vi.mock('../capture/VoiceCapture.jsx',()=>({VoiceCapture:({onCapture,bucket,mealLabel})=><button onClick={()=>onCapture('audio',bucket)}>Speak to {mealLabel}</button>}));
const rows=[{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300},{uuid:'tomato',name:'Tomatoes',mealTime:'evening',calories:20,grams:100}];
const buckets=new Map([['evening',rows]]);
const renderLog=props=>render(<MantineProvider><LogTable date="2026-09-06" byBucket={buckets} onAddTo={()=>{}} onRowTap={()=>{}} onMealChanged={()=>{}} {...props}/></MantineProvider>);
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
it('updates anticipated meals on a running clock and keeps existing dinner',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-06T20:59:55'));
 renderLog({onVoiceCapture:()=>{}});
 expect(screen.getByRole('button',{name:'Speak to Dinner'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Speak to Snacks'})).toBeNull();
 act(()=>vi.advanceTimersByTime(15000));
 expect(screen.getByRole('button',{name:'Speak to Snacks'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Speak to Dinner'})).toBeTruthy();
});
it('renders independent progress for simultaneous captures',()=>{
 renderLog({captureTasks:[{id:'a',date:'2026-09-06',bucket:'evening',startedAt:Date.now()},{id:'b',date:'2026-09-06',bucket:'evening',startedAt:Date.now()}]});
 expect(screen.getAllByRole('progressbar')).toHaveLength(2);
});
