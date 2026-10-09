import React, {useEffect} from 'react';
import {act, fireEvent, render} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {PanelRenderer, getWidgetRegistry, resetWidgetRegistry} from '../public.mjs';
import {PianoKeyboard, useMidiSubscription} from '../../../../modules/piano/browser/widget.mjs';
import {getWidgetRegistry as privateRegistry} from '../widgets/registry.js';
const transport=vi.hoisted(()=>({receive:null}));
vi.mock('../../../../frontend/src/hooks/useWebSocket.js',()=>({useWebSocketSubscription:(_topic,receive)=>{transport.receive=receive;}}));
afterEach(()=>resetWidgetRegistry());
it('M2 embedding: published Piano keyboard shares the host registry and releases MIDI listeners on unmount',()=>{
 const noteEvent=vi.fn(); let stopped=0;
 function PianoWidget(){const midi=useMidiSubscription();useEffect(()=>{const remove=midi.subscribe(noteEvent);return()=>{remove();stopped++;};},[midi.subscribe]);return <PianoKeyboard activeNotes={midi.activeNotes} startNote={60} endNote={62}/>;}
 const registry=getWidgetRegistry();expect(registry).toBe(privateRegistry());registry.register('piano-proof',PianoWidget);
 const {container,unmount}=render(<PanelRenderer node={{widget:'piano-proof'}}/>);
 const key=()=>container.querySelector('[data-note="60"]');expect(key()).not.toBeNull();
 act(()=>transport.receive({topic:'midi',type:'note',data:{event:'note_on',note:60,velocity:90}}));expect(key().classList.contains('active')).toBe(true);expect(noteEvent).toHaveBeenCalledWith(expect.objectContaining({type:'note_on',note:60}));
 act(()=>transport.receive({topic:'midi',type:'note',data:{event:'note_off',note:60,velocity:0}}));expect(key().classList.contains('active')).toBe(false);
 unmount();expect(stopped).toBe(1);const before=noteEvent.mock.calls.length;
 act(()=>{fireEvent.keyDown(window,{key:'1'});transport.receive({topic:'midi',type:'note',data:{event:'note_on',note:60,velocity:90}});});expect(noteEvent).toHaveBeenCalledTimes(before);expect(registry.get('piano-proof')).toBe(PianoWidget);
});
