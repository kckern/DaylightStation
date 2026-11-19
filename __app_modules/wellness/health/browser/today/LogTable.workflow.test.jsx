import { render,screen,fireEvent,waitFor,cleanup,act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach,it,expect,vi } from 'vitest';
import { LogTable } from "./LogTable.jsx";
import { PortionContext } from "./usePortionDraft.js";
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
 const onMoveMeal=vi.fn(async()=>'not-moved');
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
 await act(async()=>{finish('not-moved');});
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
 await act(async()=>{finish('moved');});
 expect(box('Eggs').checked).toBe(true);
});
const bar=()=>screen.getByRole('region',{name:'Selected foods'});
const yesterdayISO=()=>{const d=new Date();d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const line=name=>screen.getByText(name,{selector:'.health-row__name'}).closest('.health-row-line');
const dishDay=()=>new Map([['morning',[eggs]],['evening',[{uuid:'dish',name:'Stew',kind:'group',mealTime:'evening',calories:0},{uuid:'beef',name:'Beef',parentId:'dish',mealTime:'evening',calories:200},{uuid:'leek',name:'Leek',parentId:'dish',mealTime:'evening',calories:30}]]]);
it('the bar stays for all of selection mode, outside the two-column grid',()=>{
 const {container}=renderLog({byBucket:wholeDay,onMoveMeal:vi.fn(),onMoveToDay:vi.fn()});
 expect(screen.queryByRole('region',{name:'Selected foods'})).toBeNull();
 startSelecting();
 expect(bar().textContent).toContain('Tick foods to move');
 expect(screen.queryByRole('button',{name:/to another day/})).toBeNull();
 expect(container.querySelector('.health-log').contains(bar())).toBe(false);
 const node=bar();
 tick('Eggs');
 expect(bar()).toBe(node);
 expect(bar().textContent).not.toContain('Tick foods to move');
 tick('Eggs');
 expect(bar().textContent).toContain('Tick foods to move');
});
it('the bar stays while the ticked foods are away during a move',async()=>{
 let finish;const onMoveMeal=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(shell({onMoveMeal}));
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 const node=bar();
 rerender(shell({onMoveMeal,byBucket:new Map([['evening',[rows[0]]]])}));
 expect(bar()).toBe(node);
 rerender(shell({onMoveMeal}));
 await act(async()=>{finish('not-moved');});
 expect(box('Eggs').checked).toBe(true);
 expect(box('Tomatoes').checked).toBe(true);
});
it('closing the bar leaves the log where it was on screen',async()=>{
 const rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>({top:screen.queryByRole('region',{name:'Selected foods'})?200:150,left:0}));
 const onMoveMeal=vi.fn(async()=>'moved');
 const {container}=render(<div className="ds-chrome__main">{shell({onMoveMeal})}</div>);
 const scroller=container.querySelector('.ds-chrome__main');
 startSelecting();tick('Eggs');tick('Tomatoes');
 scroller.scrollTop=300;
 await moveTwoToSnacks();
 await waitFor(()=>expect(screen.queryByRole('region',{name:'Selected foods'})).toBeNull());
 expect(scroller.scrollTop).toBe(250);
 rect.mockRestore();
});
it('tapping a food while selecting ticks it and never opens the editor',()=>{
 const onRowTap=vi.fn();
 renderLog({byBucket:wholeDay,onRowTap,onMoveMeal:vi.fn()});
 startSelecting();
 fireEvent.click(line('Eggs'));
 expect(box('Eggs').checked).toBe(true);
 fireEvent.click(screen.getByText('Eggs',{selector:'.health-row__name'}));
 expect(box('Eggs').checked).toBe(false);
 expect(screen.queryByRole('button',{name:'Edit Eggs'})).toBeNull();
 expect(onRowTap).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByRole('button',{name:'Done selecting'})[0]);
 fireEvent.click(line('Eggs'));
 expect(onRowTap).toHaveBeenCalledTimes(1);
});
it('tapping a dish ticks all its parts, and a part-ticked dish shows as mixed',()=>{
 renderLog({byBucket:dishDay(),onMoveMeal:vi.fn()});
 startSelecting();
 tick('Beef');
 expect(box('Stew').indeterminate).toBe(true);
 expect(box('Stew').checked).toBe(false);
 fireEvent.click(line('Stew'));
 expect(box('Beef').checked).toBe(true);
 expect(box('Leek').checked).toBe(true);
 expect(box('Stew').indeterminate).toBe(false);
 expect(box('Stew').checked).toBe(true);
 fireEvent.click(line('Stew'));
 expect(box('Leek').checked).toBe(false);
});
it('the checkbox sits in its own hit area and a tap there ticks once',()=>{
 renderLog({byBucket:wholeDay,onMoveMeal:vi.fn()});
 startSelecting();
 const area=box('Eggs').closest('.health-meal-selection-tick');
 expect(area.tagName).toBe('LABEL');
 fireEvent.click(area);
 expect(box('Eggs').checked).toBe(true);
});
it('row controls that own the pointer stand down while selecting',()=>{
 const control={begin:vi.fn(()=>true),preview:vi.fn(),commit:vi.fn(),cancel:vi.fn(),draft:null,locked:false};
 render(<PortionContext.Provider value={control}>{shell({onMoveMeal:vi.fn()})}</PortionContext.Provider>);
 expect(screen.getByRole('button',{name:/Adjust calories of Eggs/})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Actions for Eggs'})).toBeTruthy();
 startSelecting();
 expect(screen.queryByRole('button',{name:/Adjust .* of Eggs/})).toBeNull();
 expect(screen.queryByRole('button',{name:'Actions for Eggs'})).toBeNull();
 const kcal=line('Eggs').querySelector('.health-row__kcal');
 fireEvent.pointerDown(kcal,{button:0,clientX:10});
 fireEvent.click(kcal);
 expect(control.begin).not.toHaveBeenCalled();
 expect(box('Eggs').checked).toBe(true);
});
it.each([
 ['meal','Move 1 selected to a meal','Breakfast','Already in Breakfast','onMoveMeal'],
 ['day','Move 1 selected to another day','Yesterday','Already on Yesterday','onMoveToDay'],
])('foods already in that %s keep their ticks and say so',async(_kind,button,choice,message,prop)=>{
 const move=vi.fn(async()=>'unchanged');const onNotice=vi.fn();
 renderLog({byBucket:wholeDay,[prop]:move,onNotice});
 startSelecting();tick('Eggs');
 fireEvent.click(screen.getByRole('button',{name:button}));
 fireEvent.click(await screen.findByRole('menuitem',{name:choice}));
 await waitFor(()=>expect(onNotice).toHaveBeenCalledWith(message));
 expect(box('Eggs').checked).toBe(true);
});
it('ticks made while a meal command runs survive it',async()=>{
 let answer;apiMock.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));
 renderLog({byBucket:wholeDay});
 startSelecting();tick('Tomatoes');tick('Beef broth');
 fireEvent.click(screen.getByRole('button',{name:'Group selected foods'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Dish name'}),{target:{value:'Soup'}});
 fireEvent.click(screen.getByRole('button',{name:'Create dish'}));
 await waitFor(()=>expect(apiMock).toHaveBeenCalled());
 tick('Eggs');
 await act(async()=>{answer({committed:true});});
 expect(box('Eggs').checked).toBe(true);
 expect(box('Tomatoes').checked).toBe(false);
});
it('a tick on a food that left the day is forgotten',()=>{
 const onMoveMeal=vi.fn();
 const {rerender}=render(shell({onMoveMeal}));
 startSelecting();tick('Eggs');tick('Tomatoes');
 expect(screen.getByRole('button',{name:'Move 2 selected to a meal'})).toBeTruthy();
 rerender(shell({onMoveMeal,byBucket:new Map([['evening',rows]])}));
 rerender(shell({onMoveMeal}));
 expect(box('Eggs').checked).toBe(false);
 expect(screen.getByRole('button',{name:'Move 1 selected to a meal'})).toBeTruthy();
});
it('selection ends when the day has no foods left to select',()=>{
 const {rerender}=render(shell({onMoveMeal:vi.fn()}));
 startSelecting();
 rerender(shell({onMoveMeal:vi.fn(),byBucket:new Map()}));
 expect(screen.queryByRole('region',{name:'Selected foods'})).toBeNull();
});
it('the count and the dish note are announced politely',()=>{
 renderLog({byBucket:dishDay(),onMoveMeal:vi.fn()});
 startSelecting();
 const status=bar().querySelector('[aria-live="polite"]');
 expect(status.textContent).toBe('Tick foods to move');
 tick('Eggs');tick('Beef');
 expect(status.textContent).toContain('1 selected');
 expect(status.textContent).toContain('Tick every ingredient to move a dish.');
 expect(bar().querySelector('[aria-live="polite"]')).toBe(status);
});
it('after a move focus returns to Select foods',async()=>{
 renderLog({byBucket:wholeDay,onMoveMeal:vi.fn(async()=>'moved')});
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 await waitFor(()=>expect(screen.queryByRole('region',{name:'Selected foods'})).toBeNull());
 expect(document.activeElement).toBe(screen.getAllByRole('button',{name:'Select foods'})[0]);
});
it('after a move focus stays where the person has since put it',async()=>{
 let finish;const onMoveMeal=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 renderLog({byBucket:wholeDay,onMoveMeal});
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 const outside=document.body.appendChild(document.createElement('button'));outside.focus();
 await act(async()=>{finish('moved');});
 expect(document.activeElement).toBe(outside);
 outside.remove();
});
it('foods cannot be dragged while selecting, by row or by meal header',()=>{
 const {container}=renderLog({byBucket:wholeDay,onMoveEntry:vi.fn(),onMoveMeal:vi.fn()});
 expect(container.querySelectorAll('.health-row-line--draggable').length).toBe(3);
 expect(container.querySelectorAll('.health-meal__header--draggable').length).toBe(2);
 startSelecting();
 expect(container.querySelectorAll('.health-row-line--draggable').length).toBe(0);
 expect(container.querySelectorAll('.health-meal__header--draggable').length).toBe(0);
});
it('the meal control waits while a day move runs',async()=>{
 let finish;const onMoveToDay=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 renderLog({byBucket:wholeDay,onMoveToDay,onMoveMeal:vi.fn()});
 startSelecting();tick('Eggs');tick('Tomatoes');
 fireEvent.click(screen.getByRole('button',{name:'Move 2 selected to another day'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Yesterday'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Move 2 selected to a meal'}).disabled).toBe(true));
 await act(async()=>{finish('not-moved');});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Move 2 selected to a meal'}).disabled).toBe(false));
});
it('foods from different meals move to another day together',async()=>{
 const onMoveToDay=vi.fn(async()=>'moved');
 renderLog({byBucket:wholeDay,onMoveToDay,onMoveMeal:vi.fn()});
 startSelecting();tick('Eggs');tick('Tomatoes');
 fireEvent.click(screen.getByRole('button',{name:'Move 2 selected to another day'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Yesterday'}));
 await waitFor(()=>expect(onMoveToDay).toHaveBeenCalledWith([expect.objectContaining({uuid:'eggs'}),expect.objectContaining({uuid:'tomato'})],yesterdayISO()));
 await waitFor(()=>expect(box('Eggs')).toBeNull());
});
it('ticking keeps the meal toolbar the same shape',()=>{
 renderLog({byBucket:wholeDay,onMoveMeal:vi.fn()});
 startSelecting();
 const group=()=>screen.getAllByText(/^Group \(/).at(-1).closest('button');
 expect(group().style.visibility).toBe('hidden');
 tick('Tomatoes');tick('Beef broth');
 expect(group().style.visibility).toBe('');
});
it('a move finishing after selection closed leaves a later day change alone',async()=>{
 let top=150;
 const rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>({top,left:0}));
 let finish;const onMoveMeal=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const view=props=><div className="ds-chrome__main">{shell({onMoveMeal,...props})}</div>;
 const {container,rerender}=render(view());
 const scroller=container.querySelector('.ds-chrome__main');
 startSelecting();tick('Eggs');tick('Tomatoes');
 await moveTwoToSnacks();
 await waitFor(()=>expect(onMoveMeal).toHaveBeenCalled());
 fireEvent.click(screen.getAllByRole('button',{name:'Done selecting'})[0]);
 await act(async()=>{finish('moved');});
 startSelecting();
 scroller.scrollTop=300;top=100;
 document.activeElement?.blur?.();
 rerender(view({date:'2026-09-05'}));
 expect(box('Eggs')).toBeNull();
 expect(scroller.scrollTop).toBe(300);
 expect(document.activeElement).toBe(document.body);
 rect.mockRestore();
});
it('opening the bar leaves the tapped meal where it was on screen',()=>{
 const rect=vi.spyOn(Element.prototype,'getBoundingClientRect').mockImplementation(()=>({top:screen.queryByRole('region',{name:'Selected foods'})?230:150,bottom:0,left:0}));
 const {container}=render(<div className="ds-chrome__main"><MantineProvider><LogTable date="2026-09-06" byBucket={buckets} onRowTap={()=>{}} onMealChanged={()=>{}} onMoveMeal={vi.fn()}/></MantineProvider></div>);
 const scroller=container.querySelector('.ds-chrome__main');
 scroller.scrollTop=40;
 fireEvent.click(screen.getByRole('button',{name:'Select foods'}));
 expect(scroller.scrollTop).toBe(120);
 fireEvent.click(screen.getByRole('button',{name:'Done selecting'}));
 rect.mockRestore();
});
it('an open dish keeps the height of its add line while foods are picked',()=>{
 const dish=[{uuid:'d',name:'Stew',kind:'group',mealTime:'evening'},{uuid:'c',name:'Carrot',parentId:'d',mealTime:'evening',calories:9,grams:9}];
 const {container}=renderLog({byBucket:new Map([['evening',dish]])});
 expect(container.querySelectorAll('.health-dish-add')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Select foods'}));
 expect(container.querySelectorAll('.health-dish-add')).toHaveLength(1);
 expect(screen.queryByRole('combobox',{name:/Add a food to/})).toBeNull();
});
it('foods being picked open no preview card',()=>{
 const {container}=renderLog();
 fireEvent.pointerEnter(container.querySelector('.health-row-name'),{pointerType:'mouse',clientX:5,clientY:5});
 expect(document.querySelector('.health-row-preview__card')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Select foods'}));
 expect(document.querySelector('.health-row-preview__card')).toBeNull();
 fireEvent.pointerEnter(container.querySelector('.health-row-name'),{pointerType:'mouse',clientX:5,clientY:5});
 expect(document.querySelector('.health-row-preview__card')).toBeNull();
});
