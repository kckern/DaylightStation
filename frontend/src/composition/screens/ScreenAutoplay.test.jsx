import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ScreenAutoplay } from './ScreenRenderer.jsx';
const hooks=vi.hoisted(()=>({push:vi.fn()}));
vi.mock("../../../../__capabilities/screen-host/browser/menu-navigation.mjs",()=>({useMenuNavigationContext:()=>({push:hooks.push})}));
vi.mock('./widgets/builtins.js',()=>({registerBuiltinWidgets:()=>{}}));
vi.mock('../../lib/fkb.js',async importOriginal=>({...await importOriginal(),bindBackButton:()=>{},enableGlobalKeyCapture:()=>{}}));
beforeEach(async()=>{vi.spyOn(await import('../../lib/api.mjs'),'DaylightAPI').mockResolvedValue({alias:null});});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();hooks.push.mockClear();});
it('preserves the FHE entry and pushes its menu only once in StrictMode',async()=>{
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room/fhe');
 render(<React.StrictMode><ScreenAutoplay routes={{fhe:{contentId:'menu:fhe',persistPath:true}}}/></React.StrictMode>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));
 expect(window.location.pathname).toBe('/screens/living-room/fhe');expect(hooks.push).toHaveBeenCalledTimes(1);
});

it('preserves a configured non-FHE menu path',async()=>{
 vi.useFakeTimers();window.history.replaceState({},'', '/screens/living-room/meeting');
 render(<ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));expect(window.location.pathname).toBe('/screens/living-room/meeting');
});

it('opens a configured source-capable alias with saved item focus',async()=>{
 const api=vi.spyOn(await import('../../lib/api.mjs'),'DaylightAPI').mockResolvedValue({alias:{owner:'agenda',canonicalContentId:'agenda:fhe'}});
 const {getActionBus}=await import('../../../../__capabilities/screen-host/browser/input.mjs');
 const emit=vi.spyOn(getActionBus(),'emit');vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room/fhe?focus_uid=uid1');
 render(<ScreenAutoplay routes={{fhe:{contentId:'menu:fhe',persistPath:true,participantSource:true}}}/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));
 expect(emit).toHaveBeenCalledWith('menu:open',{menuId:'agenda:fhe',focusUid:'uid1'});
 api.mockRestore();emit.mockRestore();
});

it('uses live ownership lookup for a TV legacy list and preserves focus',async()=>{
 const {DaylightAPI}=await import('../../lib/api.mjs');
 const api=vi.spyOn(await import('../../lib/api.mjs'),'DaylightAPI').mockResolvedValue({alias:{owner:'agenda',canonicalContentId:'agenda:fhe'}});
 const {getActionBus}=await import('../../../../__capabilities/screen-host/browser/input.mjs');const emit=vi.spyOn(getActionBus(),'emit');
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room?list=menu%3Afhe&focus_uid=saved');
 render(<ScreenAutoplay routes={{}}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));
 expect(api).toHaveBeenCalledWith('/api/v1/list/_ownership/menu/fhe');
 expect(emit).toHaveBeenCalledWith('menu:open',{menuId:'agenda:fhe',focusUid:'saved'});
 api.mockRestore();emit.mockRestore();
});

it('offers retry without falling back when ownership lookup fails',async()=>{
 const api=vi.spyOn(await import('../../lib/api.mjs'),'DaylightAPI').mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({alias:null});
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room?list=menu%3Afhe');
 const {getByRole}=render(<ScreenAutoplay routes={{}}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(getByRole('alert').textContent).toMatch(/ownership/);expect(hooks.push).not.toHaveBeenCalled();
 await act(async()=>{getByRole('button',{name:'Retry'}).click();await Promise.resolve();await Promise.resolve();});
 expect(api).toHaveBeenCalledTimes(2);
});

it('opens a configured canonical Agenda path in the registered source host',async()=>{
 const {getActionBus}=await import('../../../../__capabilities/screen-host/browser/input.mjs');const emit=vi.spyOn(getActionBus(),'emit');
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room/meeting?focus_uid=item');
 render(<ScreenAutoplay routes={{meeting:{contentId:'agenda:meeting',persistPath:true}}}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));
 expect(emit).toHaveBeenCalledWith('menu:open',{menuId:'agenda:meeting',focusUid:'item'});expect(hooks.push).not.toHaveBeenCalled();
});

it('fails closed when ownership metadata contains unexpected fields',async()=>{
 vi.spyOn(await import('../../lib/api.mjs'),'DaylightAPI').mockResolvedValue({alias:{owner:'agenda',canonicalContentId:'agenda:fhe',unexpected:true}});
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room?list=menu%3Afhe');
 const {getByRole}=render(<ScreenAutoplay routes={{}}/>);await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(getByRole('alert')).toBeTruthy();expect(hooks.push).not.toHaveBeenCalled();
});
