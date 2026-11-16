import React from 'react';
import {render, fireEvent, screen, act} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MenuNavigationProvider} from '../../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {useMenuNavigationContext} from '../../../../../__capabilities/screen-host/browser/menu-navigation.mjs';
import {ScreenOverlayProvider} from '../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
import {toListItem} from '../../../../../__capabilities/content-catalog/server/api/list.mjs';
import MenuStack from './MenuStack.jsx';

vi.mock('./PlexMenuRouter.jsx',()=>({PlexMenuRouter:()=> <div data-testid="plex"/>}));
vi.mock('../surround-host.mjs',()=>({default:({children})=>children}));
vi.mock('../playback.mjs',()=>({default:()=> <div data-testid="player"/>,PlayerOverlayLoading:()=> <div data-testid="loading"/>}));

function Depth() { const {depth}=useMenuNavigationContext(); return <div data-testid="depth">{depth}</div>; }

it('old Menu and MenuStack do not reconstruct an action from a disabled row identity', async () => {
 const row=toListItem({id:'app:game',title:'Game',thumbnail:'/cover.jpg',itemType:'container',metadata:{uid:'uid-1'},disabled:true,actions:{open:{app:'game'}}},{capabilities:['listable']});
 expect(row.uid).toBe('uid-1'); expect(row.label).toBe('Game'); expect(row.image).toBe('/cover.jpg');
 const root={title:'Week',items:[row]};
 const {container}=render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root}/><Depth/></ScreenOverlayProvider></MenuNavigationProvider>);
 const label=await screen.findByText('Game');
 expect(container.querySelector('img')?.getAttribute('src')).toBe('/cover.jpg');
 fireEvent.click(label);
 fireEvent.keyDown(window,{key:'Enter'});
 await act(async()=>{});
 expect(screen.getByText('Game')).toBeTruthy();
 expect(screen.getByTestId('depth').textContent).toBe('0');
 expect(screen.queryByTestId('player')).toBeNull();
 expect(screen.queryByTestId('plex')).toBeNull();
 expect(screen.queryByTestId('loading')).toBeNull();
});

it('blocks disabled rows from pointer and remote activation even if an action remains', async () => {
 const select=vi.fn();
 const {TVMenu}=await import('./Menu.jsx');
 render(<TVMenu list={{title:'Preview',notice:'Preview only',items:[{uid:'x',label:'Disabled',disabled:true,open:{app:'game'}}]}} onSelect={select}/>);
 const label=await screen.findByText('Disabled');
 fireEvent.click(label); fireEvent.keyDown(window,{key:'Enter'}); fireEvent.keyDown(window,{key:'GamepadA'});
 await act(async()=>{});
 expect(select).not.toHaveBeenCalled();
 expect(screen.getByText('Preview only')).toBeTruthy();
});
