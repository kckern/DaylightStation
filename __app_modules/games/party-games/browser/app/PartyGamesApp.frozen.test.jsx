import React from 'react';
import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PartyGamesApp from './PartyGamesApp.jsx';
import {DaylightAPI} from '@/lib/api.mjs';
vi.mock('@/lib/api.mjs',async original=>({...await original(),DaylightAPI:vi.fn()}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketStatus:()=>({connected:true}),useWebSocketSubscription:()=>{}}));
vi.mock('../../../../../__capabilities/screen-host/browser/input/adapters/GamepadAdapter.js',()=>({acquireGamepadInputHost:()=>({release:()=>{}}),bindNextGamepadPress:()=>{},cancelPendingGamepadBind:()=>{},clearGamepadRoleBindings:()=>{},restoreGamepadRoleBindings:()=>{}}));
vi.mock('./PartyGamesExperience.jsx',()=>({default:({sessionId,seats})=><div>Attached {sessionId}: {seats.map(s=>s.id).join(',')}</div>}));
afterEach(()=>{vi.restoreAllMocks();window.history.replaceState({},'','/');});
it.each(['unavailable','invalid row'])('uses the real client and reducer after catalog retirement: %s',async catalogState=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:old?session=game%3Aold');
 DaylightAPI.mockImplementation(async path=>{
  if(path.endsWith('/profile')) throw Error('profile unavailable');
  if(path.endsWith('/catalog')) { if (catalogState === 'unavailable') throw Error('catalog unavailable'); return {entries:[{definition_id:'charades:old',valid:false}]}; }
  if(path.endsWith('/sessions/game%3Aold')) return {header:{session_id:'game:old',experience:{id:'charades',version:1},artifacts:{rules_definition:{id:'charades:old'}},participants:[],seats:[{id:'guest:old'}],launch:{participant_launch:{schema:'participant-session-attachment/v1',launch_id:'l',snapshot_hash:'h',consumer:{id:'party-games',version:1}}}},definition:{experience:{id:'charades',version:1},competition:false},state:{competition:false}};
  throw Error(`Unexpected request ${path}`);
 });
 render(<PartyGamesApp definitionId="charades:old"/>);
 expect(await screen.findByText('Attached game:old: guest:old')).toBeVisible();
 expect(DaylightAPI.mock.calls.some(([path])=>path==='api/v1/gaming/sessions')).toBe(false);
});
