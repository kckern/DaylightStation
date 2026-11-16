import React from 'react';
import {act,render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {ScreenAutoplay} from './ScreenRenderer.jsx';
import {MenuNavigationProvider} from '../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {useMenuNavigationContext} from '../../../../__capabilities/screen-host/browser/menu-navigation.mjs';
import {ScreenOverlayProvider,useScreenOverlay} from '../../../../__capabilities/screen-host/browser/overlays.mjs';
import {getActionBus} from '../../../../__capabilities/screen-host/browser/input.mjs';
import * as api from '../../lib/api.mjs';
vi.mock('./widgets/builtins.js',()=>({registerBuiltinWidgets(){}}));
vi.mock('../../lib/fkb.js',async original=>({...await original(),bindBackButton(){},enableGlobalKeyCapture(){}}));
function Driver(){const nav=useMenuNavigationContext(),overlay=useScreenOverlay();return <><button onClick={()=>nav.push({type:'app',props:{open:'new'}})}>Stack activity</button><button onClick={()=>overlay.showOverlay(()=><div>New fullscreen</div>,{},{priority:'high'})}>Fullscreen activity</button><output data-testid="stack">{JSON.stringify(nav.stack)}</output></>;}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
for(const mode of ['route','query']) for(const intent of ['Escape','hardware','stack','fullscreen','menu-event']) for(const outcome of ['success','failure']) {
 it(`${mode} ignores late ${outcome} after ${intent}`,async()=>{
  vi.useFakeTimers();let resolve,reject;const deferred=new Promise((yes,no)=>{resolve=yes;reject=no;});
  vi.spyOn(api,'DaylightAPI').mockReturnValue(deferred);
  const emit=vi.spyOn(getActionBus(),'emit');
  window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
  render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
  if(intent==='Escape') fireEvent.keyDown(window,{key:'Escape'});
  if(intent==='hardware') fireEvent.popState(window);
  if(intent==='stack') fireEvent.click(screen.getByText('Stack activity'));
  if(intent==='fullscreen') fireEvent.click(screen.getByText('Fullscreen activity'));
  if(intent==='menu-event') act(()=>getActionBus().emit('menu:open',{menuId:'menu:new'}));
  emit.mockClear();
  await act(async()=>{if(outcome==='success')resolve({alias:{owner:'agenda',canonicalContentId:'agenda:stale'}});else reject(Error('offline'));await deferred.catch(()=>{});});
  act(()=>vi.advanceTimersByTime(501));
  expect(emit).not.toHaveBeenCalledWith('menu:open',expect.objectContaining({menuId:'agenda:stale'}));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('stack').textContent).not.toContain('meeting');
  if(intent==='stack') expect(screen.getByTestId('stack').textContent).toContain('new');
  if(intent==='fullscreen') expect(screen.getByText('New fullscreen')).toBeTruthy();
 });
}
it.each(['route','query'])('%s cancels a resolved ownership timer and an error Retry',async mode=>{
 vi.useFakeTimers();const apiSpy=vi.spyOn(api,'DaylightAPI').mockResolvedValue({alias:null});const emit=vi.spyOn(getActionBus(),'emit');
 window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
 const ui=render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();});fireEvent.popState(window);act(()=>vi.advanceTimersByTime(501));
 expect(screen.getByTestId('stack').textContent).not.toContain('meeting');expect(emit).not.toHaveBeenCalledWith('menu:open',expect.anything());ui.unmount();
 window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
 apiSpy.mockRejectedValueOnce(Error('offline'));let resolve;const retry=new Promise(yes=>{resolve=yes;});
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();});expect(screen.getByRole('alert')).toBeTruthy();
 apiSpy.mockReturnValue(retry);fireEvent.click(screen.getByText('Retry'));fireEvent.popState(window);
 await act(async()=>resolve({alias:null}));act(()=>vi.advanceTimersByTime(501));
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByTestId('stack').textContent).not.toContain('meeting');expect(emit).not.toHaveBeenCalledWith('menu:open',expect.anything());
});

it.each(['route','query'])('%s ignores Retry failure after semantic Back',async mode=>{
 vi.useFakeTimers();const lookup=vi.spyOn(api,'DaylightAPI').mockRejectedValueOnce(Error('offline'));
 window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();});expect(screen.getByRole('alert')).toBeTruthy();
 let reject;lookup.mockReturnValue(new Promise((_yes,no)=>{reject=no;}));fireEvent.click(screen.getByText('Retry'));
 act(()=>getActionBus().emit('escape',{}));await act(async()=>{reject(Error('late failure'));await Promise.resolve();});
 act(()=>vi.advanceTimersByTime(501));expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByTestId('stack').textContent).toBe('[]');
});

it.each(['route','query'])('%s delivers autoplay once after real MenuWidget initialization resets the stack',async mode=>{
 const {default:MenuWidget}=await import('./widgets/MenuWidget.jsx');
 const {ScreenActionHandler}=await import('./actions/ScreenActionHandler.jsx');
 vi.useFakeTimers();
 vi.spyOn(api,'DaylightAPI').mockImplementation(async url=>url.includes('_ownership')?{alias:null}:{title:'Menu',items:[{label:url.includes('watchlist')?'Widget initial':'Autoplay item'}]});
 const emit=vi.spyOn(getActionBus(),'emit');
 window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><MenuWidget source="neutral"/><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});expect(screen.getByText('Widget initial')).toBeTruthy();
 await act(async()=>{vi.advanceTimersByTime(501);await Promise.resolve();await Promise.resolve();});
 expect(screen.getByText('Autoplay item')).toBeTruthy();
 if(mode==='route') expect(JSON.parse(screen.getByTestId('stack').textContent)).toHaveLength(1);
 else expect(emit.mock.calls.filter(([event])=>event==='menu:open')).toHaveLength(1);
 act(()=>vi.advanceTimersByTime(1000));expect(screen.getAllByText('Autoplay item')).toHaveLength(1);
});

it.each(['/screens/test/webcam','/screens/test?play=files%3Asong'])('preserves ordinary app/media autoplay at %s',async url=>{
 vi.useFakeTimers();vi.spyOn(api,'DaylightAPI').mockResolvedValue({alias:null});const emit=vi.spyOn(getActionBus(),'emit');
 window.history.replaceState({},'',url);
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenAutoplay/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();});act(()=>vi.advanceTimersByTime(501));
 expect(emit.mock.calls.filter(([event])=>['menu:open','media:play'].includes(event))).toHaveLength(1);
});

it.each(['route','query'])('%s cancels ownership as soon as a real widget starts a newer pending selection',async mode=>{
 const {default:MenuWidget}=await import('./widgets/MenuWidget.jsx');vi.useFakeTimers();
 let resolveAutoplay,resolveSelection;
 const autoplay=new Promise(resolve=>{resolveAutoplay=resolve;}),selection=new Promise(resolve=>{resolveSelection=resolve;});
 vi.spyOn(api,'DaylightAPI').mockImplementation(async url=>{
  if(url.includes('_ownership/menu/meeting'))return autoplay;
  if(url.includes('_ownership/menu/new'))return selection;
  return {title:'Widget',items:[{uid:'new',label:'New selection',list:{contentId:'menu:new'}}]};
 });
 const emit=vi.spyOn(getActionBus(),'emit');window.history.replaceState({},'',mode==='route'?'/screens/test/meeting':'/screens/test?list=menu%3Ameeting');
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuWidget source="neutral"/><ScreenAutoplay routes={{meeting:{contentId:'menu:meeting',persistPath:true}}}/><Driver/></ScreenOverlayProvider></MenuNavigationProvider>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});fireEvent.click(screen.getByText('New selection'));
 await act(async()=>resolveAutoplay({alias:{owner:'agenda',canonicalContentId:'agenda:stale'}}));act(()=>vi.advanceTimersByTime(501));
 expect(screen.getByTestId('stack').textContent).toBe('[]');expect(emit).not.toHaveBeenCalledWith('menu:open',expect.objectContaining({menuId:'agenda:stale'}));
 await act(async()=>resolveSelection({alias:null}));expect(screen.getByTestId('stack').textContent).toContain('menu:new');
});
