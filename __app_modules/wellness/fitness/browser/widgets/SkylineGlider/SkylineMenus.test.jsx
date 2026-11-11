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
