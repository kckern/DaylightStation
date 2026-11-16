import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act,waitFor} from '@testing-library/react';
import {MenuNavigationProvider} from '../../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {useMenuNavigationContext} from '../../../../../__capabilities/screen-host/browser/menu-navigation.mjs';
import {ScreenOverlayProvider,useScreenOverlay} from '../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
import {getActionBus} from '../../../../../__capabilities/screen-host/browser/input.mjs';
import {ScreenActionHandler} from './ScreenActionHandler.jsx';
import MenuWidget from '../widgets/MenuWidget.jsx';
import MenuStack from '../../../../../__app_modules/media/media/browser/menu.mjs';
import * as api from '../../../lib/api.mjs';
vi.mock('../../../lib/api.mjs',async original=>({...await original(),DaylightAPI:vi.fn()}));
vi.mock('../../../../../__app_modules/household/agenda/browser/screen.mjs',()=>({default:({contentId})=><div>Agenda host: {contentId}</div>,createAgendaMenuController:vi.fn()}));
vi.mock('../../../../../__app_modules/media/media/browser/menu/PlexMenuRouter.jsx',()=>({PlexMenuRouter:()=>null}));
vi.mock('../../../../../__app_modules/media/media/browser/surround-host.mjs',()=>({default:({children})=>children}));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs',()=>({default:()=>null,PlayerOverlayLoading:()=>null}));
function Driver(){const {showOverlay}=useScreenOverlay();const {push,depth}=useMenuNavigationContext();return <><button onClick={()=>showOverlay(MenuStack,{rootMenu:{title:'Overlay',items:[]}},{priority:'high',ownsNavStack:true})}>Open overlay</button><button onClick={()=>push({type:'menu',props:{list:{title:'Nested',items:[{label:'Nested item'}]}}})}>Push nested</button><output data-testid="depth">{depth}</output></>;}
it('retries an ownership error without remounting the real widget or resetting the owning overlay stack',async()=>{
 api.DaylightAPI.mockImplementation(async url=>url.includes('_ownership/menu/') ? Promise.reject(new Error('offline')) : {title:'Widget',items:[{label:'Widget item'}]});
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><Driver/><MenuWidget source="neutral"/></ScreenOverlayProvider></MenuNavigationProvider>);
 await screen.findByText('Widget item');fireEvent.click(screen.getByText('Open overlay'));fireEvent.click(screen.getByText('Push nested'));await screen.findByText('Nested item');expect(screen.getByTestId('depth')).toHaveTextContent('1');
 act(()=>getActionBus().emit('menu:open',{menuId:'menu:neutral'}));await screen.findByRole('alert',{name:'Menu error'});await act(async()=>{await Promise.resolve();await Promise.resolve();});expect(screen.queryByText('Widget item')).toBeNull();expect(screen.getByTestId('depth')).toHaveTextContent('1');
 api.DaylightAPI.mockImplementation(async url=>url.includes('_ownership/menu/') ? {alias:{owner:'agenda',canonicalContentId:'agenda:neutral'}} : {title:'Widget',items:[{label:'Widget item'}]});
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByText('Agenda host: agenda:neutral')).toBeTruthy();await waitFor(()=>expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull());
});
