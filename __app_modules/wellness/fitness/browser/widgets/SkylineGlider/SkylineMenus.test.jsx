import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import SkylineMenus, { crashReason } from './SkylineMenus.jsx';
import { createSkylineControlState,reduceSkylineControl } from '../../lib/skylineGlider/controllerModel.js';
it('selects an option through the same model as physical navigation',()=>{
 const acts=[{id:'one',name:'One',status:'open'},{id:'two',name:'Two',status:'locked'}],riders=[{id:'child',name:'Child',position:1}];
 let state={...createSkylineControlState({acts,riders}),phase:'flights',riderId:'child',actId:'one'};
 const onEvent=vi.fn(e=>{state=reduceSkylineControl(state,e).state});
 render(<SkylineMenus state={state} acts={acts} riders={riders} onEvent={onEvent}/>);
 fireEvent.click(screen.getByRole('button',{name:/Two/}));
 expect(state.actId).toBe('two');
 expect(screen.getByText(/Admin unlock/)).toBeVisible();
});
// 2026-11-10: the identity screen listed the same four riders twice — a 2×2
// grid here and the bike-button panel beside it. The panel is the one list.
it('lists no riders of its own on the identity screen: the bike-button panel carries them',()=>{
 const riders=[{id:'a',name:'Rider A',position:1,avatarSrc:'/a.jpg'},{id:'b',name:'Rider B',position:2,avatarSrc:'/b.jpg'}];
 const onEvent=vi.fn();
 render(<SkylineMenus state={{...createSkylineControlState({acts:[],riders}),phase:'identity'}} acts={[]} riders={riders} onEvent={onEvent}/>);
 expect(screen.getByTestId('skyline-identity')).toHaveTextContent(/Who’s flying\?/);
 expect(screen.getByText(/Press your rider button on the pad/)).toBeVisible();
 expect(screen.queryAllByRole('button')).toHaveLength(0);
 expect(screen.queryByText(/Rider A|Rider B|Button [1-4]/)).toBeNull();
});
it('names what ended the attempt in words a rider can act on',()=>{
 expect(crashReason({crashCause:'stall'})).toMatch(/pedal/i);
 expect(crashReason({crashCause:'entity'},{role:'bomb'})).toMatch(/bomb/i);
 expect(crashReason({crashCause:'lives'},{role:'shoot'})).toMatch(/shoot/i);
 render(<SkylineMenus state={{phase:'crash',riders:[],acts:[]}} riders={[]} acts={[]} onEvent={()=>{}} crashNote="Hit the ground."/>);
 expect(screen.getByTestId('skyline-glider-crash-cause')).toHaveTextContent('Hit the ground.');
});
// 2026-11-12: fourteen configured flights ran the list off the garage display,
// and the chosen one (driven by the bike buttons) scrolled out of sight.
it('shows a fixed window of flights that follows the bike-button cursor',()=>{
 const acts=Array.from({length:14},(_,i)=>({id:'a'+i,name:'Flight '+i,status:'open'})),riders=[{id:'child',name:'Child',position:1}];
 const at=actId=>({...createSkylineControlState({acts,riders}),phase:'flights',riderId:'child',actId});
 const rows=()=>screen.getAllByRole('button').map(b=>b.textContent);
 const view=render(<SkylineMenus state={at('a0')} acts={acts} riders={riders} onEvent={()=>{}}/>);
 expect(rows()).toHaveLength(5);expect(rows()[0]).toMatch(/Flight 0/);
 expect(screen.getByText('1 of 14')).toBeVisible();
 expect(screen.getByTestId('skyline-more-below')).toHaveTextContent('9 more');
 view.rerender(<SkylineMenus state={at('a13')} acts={acts} riders={riders} onEvent={()=>{}}/>);
 expect(rows()).toHaveLength(5);expect(rows().at(-1)).toMatch(/Flight 13/);
 expect(screen.getByRole('button',{pressed:true})).toHaveTextContent('Flight 13');
 expect(screen.getByTestId('skyline-more-above')).toHaveTextContent('9 more');
 view.rerender(<SkylineMenus state={at('a7')} acts={acts} riders={riders} onEvent={()=>{}}/>);
 expect(rows().map(r=>r.match(/Flight \d+/)[0])).toEqual(['Flight 5','Flight 6','Flight 7','Flight 8','Flight 9']);
});
// 2026-11-11: a locked flight was drawn see-through (transparent fill, faded
// text) and read as broken from the bike. Every flight row — open, completed,
// locked, chosen or not — is a solid plate at full opacity.
it('draws every flight row solid: no opacity below 1, no see-through fill',async()=>{
 const {compile}=await import('sass');
 const {fileURLToPath}=await import('node:url');
 const css=compile(fileURLToPath(new URL('./SkylineGlider.scss',import.meta.url))).css;
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,sel])=>sel.includes('.skyline-menus__options button'));
 expect(rules.some(([sel])=>sel.includes('[data-status=locked]')||sel.includes('[data-status="locked"]'))).toBe(true);
 for(const [,sel,body] of rules){
  for(const [,v] of body.matchAll(/(?:^|;)\s*opacity:\s*([^;]+)/g))expect([sel,Number(v)]).toEqual([sel,1]);
  expect([sel,/background(-color)?:\s*(transparent|rgba|hsla)/.test(body)]).toEqual([sel,false]);
  expect([sel,/filter:/.test(body)]).toEqual([sel,false]);
 }
 const acts=[{id:'one',name:'One',status:'completed'},{id:'two',name:'Two',status:'locked'}],riders=[{id:'child',name:'Child',position:1}];
 for(const actId of ['one','two']){
  const {container,unmount}=render(<SkylineMenus state={{...createSkylineControlState({acts,riders}),phase:'flights',riderId:'child',actId}} acts={acts} riders={riders} onEvent={()=>{}}/>);
  for(const el of container.querySelectorAll('.skyline-menus__options button, .skyline-menus__options button *'))expect(el.getAttribute('style')||'').not.toMatch(/opacity/);
  unmount();
 }
});
