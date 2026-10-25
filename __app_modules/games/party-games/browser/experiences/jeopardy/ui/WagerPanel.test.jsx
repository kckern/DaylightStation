import React,{useRef,useState} from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {useScopedRemoteControls} from '../../../../../../../__capabilities/screen-host/browser/input.mjs';
import WagerPanel from './WagerPanel.jsx';
function RemoteWager({confirm}){
 const root=useRef(null);const [value,setValue]=useState(100);useScopedRemoteControls(root);
 return <div ref={root}><WagerPanel teamName="Blue Team" score={500} roundMax={300} value={value} onChange={setValue} onConfirm={confirm}/></div>;
}
it('makes OK lock the displayed wager when focus is lost instead of silently decreasing it',()=>{
 const confirm=vi.fn();render(<RemoteWager confirm={confirm}/>);
 expect(screen.getByRole('button',{name:'Lock wager'})).toHaveFocus();
 document.activeElement.blur();fireEvent.keyDown(window,{key:'Enter'});
 expect(confirm).toHaveBeenCalledWith(100);
});
