import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import { useScopedRemoteControls } from './useScopedRemoteControls.js';
function Controls({ action, exit }) { const ref=useRef(null); useScopedRemoteControls(ref,{onEscape:exit}); return <div ref={ref}><button onClick={action}>One</button><button onClick={action}>Two</button></div>; }
it('owns native remote input and activates the focused button once per press', () => {
 const action=vi.fn(), exit=vi.fn(), outer=vi.fn(); window.addEventListener('keydown',outer);
 render(<Controls action={action} exit={exit}/>);
 fireEvent.keyDown(window,{key:'ArrowRight'}); expect(screen.getByText('Two')).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'}); fireEvent.keyDown(window,{key:'Enter',repeat:true}); expect(action).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(window,{key:'Escape'}); expect(exit).toHaveBeenCalledTimes(1); expect(outer).not.toHaveBeenCalled(); window.removeEventListener('keydown',outer);
});

it('handles each real GamepadAdapter semantic action once despite its legacy synthetic key event',async()=>{
 const {GamepadAdapter}=await import('./adapters/GamepadAdapter.js');
 const {getActionBus}=await import('./ActionBus.js');
 const action=vi.fn(),exit=vi.fn(),legacy=vi.fn();
 render(<Controls action={action} exit={exit}/>);window.addEventListener('keydown',legacy);
 const adapter=new GamepadAdapter(getActionBus());
 adapter._emit({key:'ArrowRight',action:'navigate',payload:{direction:'right'}},15);
 expect(screen.getByText('Two')).toHaveFocus();
 adapter._emit({key:'Enter',action:'select',payload:{}},0);expect(action).toHaveBeenCalledTimes(1);
 adapter._emit({key:'Escape',action:'escape',payload:{}},8);expect(exit).toHaveBeenCalledTimes(1);
 expect(legacy).not.toHaveBeenCalled();window.removeEventListener('keydown',legacy);adapter.destroy();
});

it('claims semantic Back before a parent screen subscriber and releases ownership on unmount',async()=>{
 const {getActionBus}=await import('./ActionBus.js');const bus=getActionBus();
 const parent=vi.fn();const unsubscribe=bus.subscribe('escape',parent);const exit=vi.fn();
 const view=render(<Controls action={()=>{}} exit={exit}/>);
 bus.emit('escape',{});expect(exit).toHaveBeenCalledTimes(1);expect(parent).not.toHaveBeenCalled();
 view.unmount();bus.emit('escape',{});expect(parent).toHaveBeenCalledTimes(1);unsubscribe();
});

it('does not emit a legacy Back after the semantic owner unmounts synchronously',async()=>{
 const {GamepadAdapter}=await import('./adapters/GamepadAdapter.js');const {RemoteAdapter}=await import('./adapters/RemoteAdapter.js');const {getActionBus}=await import('./ActionBus.js');
 const bus=getActionBus(),parent=vi.fn(),legacy=vi.fn();const unsubscribe=bus.subscribe('escape',parent);
 let view;const exit=vi.fn(()=>view.unmount());view=render(<Controls action={()=>{}} exit={exit}/>);
 const remote=new RemoteAdapter(bus);await remote.attach();window.addEventListener('keydown',legacy);
 const adapter=new GamepadAdapter(bus);adapter._emit({key:'Escape',action:'escape',payload:{}},8);
 expect(exit).toHaveBeenCalledTimes(1);expect(parent).not.toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled();
 unsubscribe();remote.destroy();adapter.destroy();window.removeEventListener('keydown',legacy);
});
