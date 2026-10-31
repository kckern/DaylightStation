import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import SkylineMenus from './SkylineMenus.jsx';
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
