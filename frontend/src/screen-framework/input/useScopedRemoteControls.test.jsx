import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import { useScopedRemoteControls } from './useScopedRemoteControls.js';
function Controls({ action, exit }) { const ref=useRef(null); useScopedRemoteControls(ref,{onEscape:exit}); return <div ref={ref}><button onClick={action}>One</button><button onClick={action}>Two</button></div>; }
function DirectionalControls({ back, forward }) { const ref=useRef(null); useScopedRemoteControls(ref,{onLeft:back,onRight:forward}); return <div ref={ref}><button>One</button><button>Two</button></div>; }
it('owns native remote input and activates the focused button once per press', () => {
 const action=vi.fn(), exit=vi.fn(), outer=vi.fn(); window.addEventListener('keydown',outer);
 render(<Controls action={action} exit={exit}/>);
 fireEvent.keyDown(window,{key:'ArrowRight'}); expect(screen.getByText('Two')).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'}); fireEvent.keyDown(window,{key:'Enter',repeat:true}); expect(action).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(window,{key:'Escape'}); expect(exit).toHaveBeenCalledTimes(1); expect(outer).not.toHaveBeenCalled(); window.removeEventListener('keydown',outer);
});

it('maps left and right to game back and forward actions once per remote press', () => {
 const back=vi.fn(()=>true),forward=vi.fn(()=>true);render(<DirectionalControls back={back} forward={forward}/>);
 fireEvent.keyDown(window,{key:'ArrowLeft'});fireEvent.keyDown(window,{key:'ArrowLeft',repeat:true});
 fireEvent.keyDown(window,{key:'ArrowRight'});fireEvent.keyDown(window,{key:'ArrowRight',repeat:true});
 expect(back).toHaveBeenCalledTimes(1);expect(forward).toHaveBeenCalledTimes(1);
 expect(screen.getByText('One')).toHaveFocus();
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

function SvgFirstControls({ action }) { const ref=useRef(null); useScopedRemoteControls(ref); return <div ref={ref}><svg><use href="#icon"/></svg><button onClick={action}>Go</button></div>; }
it('never treats an SVG href as a control — select with nothing focused activates the first real button', () => {
 // 2026-09-13..14: `[href]` matched an icon's SVG <use>, which has no click(),
 // and Enter threw "click is not a function" 17 times in Charades.
 const action=vi.fn(); render(<SvgFirstControls action={action}/>); document.activeElement?.blur?.();
 fireEvent.keyDown(window,{key:'Enter'}); expect(action).toHaveBeenCalledTimes(1);
});
