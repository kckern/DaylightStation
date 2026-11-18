import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach,it,expect,vi } from 'vitest';
import { LogTable } from "./LogTable.jsx";
import { VoiceCapture } from "../capture/VoiceCapture.jsx";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("../../../../../frontend/src/lib/api.mjs",()=>({DaylightAPI:(...args)=>apiMock(...args)}));
vi.mock("../capture/VoiceCapture.jsx",()=>({VoiceCapture:({onCapture,bucket,mealLabel})=><button onClick={()=>onCapture('audio',bucket)}>Speak to {mealLabel}</button>}));
const rows=[{uuid:'broth',name:'Beef broth',mealTime:'evening',calories:90,grams:300},{uuid:'tomato',name:'Tomatoes',mealTime:'evening',calories:20,grams:100}];
const buckets=new Map([['evening',rows]]);
// The meal's mic lives in its add row; this stand-in row mounts the same
// VoiceCapture with the capture its section hands it.
const addRow=(bucket,label,meal)=>meal.onVoiceCapture?<VoiceCapture bucket={bucket} mealLabel={label} onCapture={meal.onVoiceCapture}/>:null;
const renderLog=props=>render(<MantineProvider><LogTable date="2026-09-06" byBucket={buckets} onRowTap={()=>{}} onMealChanged={()=>{}} renderAddRow={addRow} {...props}/></MantineProvider>);
afterEach(()=>{cleanup();vi.useRealTimers();apiMock.mockReset();});
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
it('moves every ticked food to another day in one step, and leaves the rest', async()=>{
 const onMoveToDay=vi.fn(async()=>{});
 renderLog({onMoveToDay});
 fireEvent.click(screen.getByRole('button',{name:'Select foods'}));
 expect(screen.queryByRole('button',{name:/to another day/})).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Beef broth'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Tomatoes'}));
 fireEvent.click(screen.getByRole('button',{name:'Move 2 selected to another day'}));
 fireEvent.click(await screen.findByText('Yesterday'));
 const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 const iso=`${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
 await waitFor(()=>expect(onMoveToDay).toHaveBeenCalledWith([expect.objectContaining({uuid:'broth'}),expect.objectContaining({uuid:'tomato'})],iso));
 await waitFor(()=>expect(screen.queryByRole('checkbox',{name:'Select Beef broth'})).toBeNull()); // selection mode closes
});
const eggs={uuid:'eggs',name:'Eggs',mealTime:'morning',calories:90,grams:50};
const wholeDay=new Map([['morning',[eggs]],['evening',rows]]);
const startSelecting=()=>fireEvent.click(screen.getAllByRole('button',{name:'Select foods'})[0]);
const tick=name=>fireEvent.click(screen.getByRole('checkbox',{name:`Select ${name}`}));
const box=name=>screen.queryByRole('checkbox',{name:`Select ${name}`});
const moveTwoToSnacks=async()=>{
 fireEvent.click(screen.getByRole('button',{name:'Move 2 selected to a meal'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Snacks'}));
};
const shell=(props)=><MantineProvider><LogTable date="2026-09-06" byBucket={wholeDay} onRowTap={()=>{}} onMealChanged={()=>{}} renderAddRow={addRow} {...props}/></MantineProvider>;
it('selects across meals and moves them together to a day or a meal',async()=>{
 const onMoveToDay=vi.fn(async()=>{});const onMoveMeal=vi.fn(async()=>{});
 const byBucket=new Map([['morning',[{uuid:'eggs',name:'Eggs',mealTime:'morning',calories:90,grams:50}]],['evening',rows]]);
 renderLog({byBucket,onMoveToDay,onMoveMeal});
 fireEvent.click(screen.getAllByRole('button',{name:'Select foods'})[0]);
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Eggs'}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Select Tomatoes'}));
 fireEvent.click(screen.getByRole('button',{name:'Move 2 selected to a meal'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Snacks'}));
 await waitFor(()=>expect(onMoveMeal).toHaveBeenCalledWith([expect.objectContaining({uuid:'eggs'}),expect.objectContaining({uuid:'tomato'})],'night',null));
 await waitFor(()=>expect(box('Eggs')).toBeNull());
});
it('a dish moves whole across the day, and a part-ticked dish only earns the note',async()=>{
 const dish={uuid:'dish',name:'Stew',kind:'group',mealTime:'evening',calories:0};
 const parts=[{uuid:'beef',name:'Beef',parentId:'dish',mealTime:'evening',calories:200},{uuid:'leek',name:'Leek',parentId:'dish',mealTime:'evening',calories:30}];
 const onMoveMeal=vi.fn(async()=>{});
 renderLog({byBucket:new Map([['morning',[eggs]],['evening',[dish,...parts]]]),onMoveMeal});
 startSelecting();tick('Eggs');tick('Beef');
 expect(screen.getByText('Tick every ingredient to move a dish.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Move 1 selected to a meal'})).toBeTruthy();
 tick('Leek');
 expect(screen.queryByText('Tick every ingredient to move a dish.')).toBeNull();
 await moveTwoToSnacks();
 await waitFor(()=>expect(onMoveMeal).toHaveBeenCalledWith([expect.objectContaining({uuid:'eggs'}),expect.objectContaining({uuid:'dish',children:parts})],'night',null));
});
it('a move that did not happen keeps the foods ticked so it can be tried again',async()=>{
 const onMoveMeal=vi.fn(async()=>false);
 renderLog({byBucket:wholeDay,onMoveMeal});
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 await waitFor(()=>expect(onMoveMeal).toHaveBeenCalled());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Move 2 selected to a meal'}).disabled).toBe(false));
 expect(box('Eggs').checked).toBe(true);
 expect(box('Tomatoes').checked).toBe(true);
});
it('one move runs at a time: the other control waits for it',async()=>{
 let finish;const onMoveMeal=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 renderLog({byBucket:wholeDay,onMoveMeal,onMoveToDay:vi.fn(async()=>{})});
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Move 2 selected to another day'}).disabled).toBe(true));
 await act(async()=>{finish(false);});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Move 2 selected to another day'}).disabled).toBe(false));
});
it('each meal voice and grouping see only that meal\'s ticked foods',()=>{
 const voice=vi.fn(async()=>({}));
 renderLog({byBucket:wholeDay,onVoiceCapture:voice,onMoveMeal:vi.fn()});
 startSelecting();tick('Eggs');tick('Tomatoes');
 expect(screen.queryByRole('button',{name:'Group selected foods'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Speak to Dinner'}));
 expect(voice).toHaveBeenCalledWith('audio','evening',{date:'2026-09-06',selectedIds:['tomato']});
 tick('Beef broth');
 expect(screen.getByRole('button',{name:'Group selected foods'}).textContent).toBe('Group (2)');
});
it('a command in one meal leaves the foods ticked in the others',async()=>{
 apiMock.mockResolvedValue({committed:true});
 renderLog({byBucket:wholeDay});
 startSelecting();tick('Eggs');tick('Tomatoes');tick('Beef broth');
 fireEvent.click(screen.getByRole('button',{name:'Group selected foods'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Dish name'}),{target:{value:'Soup'}});
 fireEvent.click(screen.getByRole('button',{name:'Create dish'}));
 await waitFor(()=>expect(box('Tomatoes').checked).toBe(false));
 expect(apiMock.mock.calls[0][1].selectedIds).toEqual(['broth','tomato']);
 expect(box('Eggs').checked).toBe(true);
});
it('a meal command closes selection when nothing else is ticked',async()=>{
 apiMock.mockResolvedValue({committed:true});
 renderLog({byBucket:wholeDay});
 startSelecting();tick('Tomatoes');tick('Beef broth');
 fireEvent.click(screen.getByRole('button',{name:'Group selected foods'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Dish name'}),{target:{value:'Soup'}});
 fireEvent.click(screen.getByRole('button',{name:'Create dish'}));
 await waitFor(()=>expect(box('Eggs')).toBeNull());
});
it('selection belongs to the viewed day',()=>{
 const {rerender}=render(shell({onMoveMeal:vi.fn()}));
 startSelecting();tick('Eggs');
 rerender(shell({date:'2026-09-05',onMoveMeal:vi.fn()}));
 expect(box('Eggs')).toBeNull();
 expect(screen.queryByRole('button',{name:/selected to a meal/})).toBeNull();
 startSelecting();
 expect(box('Eggs').checked).toBe(false);
});
it('a move finishing after the day changed leaves the new day\'s selection alone',async()=>{
 let finish;const onMoveMeal=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(shell({onMoveMeal}));
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 await waitFor(()=>expect(onMoveMeal).toHaveBeenCalled());
 rerender(shell({date:'2026-09-05',onMoveMeal}));
 startSelecting();tick('Eggs');
 await act(async()=>{finish(true);});
 expect(box('Eggs').checked).toBe(true);
});
