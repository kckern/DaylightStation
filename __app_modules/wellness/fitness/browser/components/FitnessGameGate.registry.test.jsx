import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,act} from '@testing-library/react';
vi.mock('@/lib/api.mjs',async original=>({...await original(),DaylightAPI:async()=>{const start=Date.parse('2026-11-15T08:00:00Z');return {items:[{capabilityId:'fitness.games-unsupervised',subject:{kind:'household',id:'home'},period:{kind:'local_day',id:'2026-11-15',startsAt:start,endsAt:start+86400000},validFrom:start,validUntil:start+86400000,decision:'denied',basisState:'unsatisfied',degraded:false}]};}}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:()=>{}}));
vi.mock('../context/FitnessContext.jsx',()=>({useFitnessContext:()=>({fitnessConfiguration:{_household:'home'}})}));
vi.mock('../identity/useIdentity.js',()=>({useIdentity:()=>({registerAdmin:vi.fn(),clearUnlock:vi.fn(),unlockState:'idle'})}));
vi.mock('../widgets/JumpingJackGame/JumpingJackGame.jsx',()=>({default:()=> <p>Unguarded game body</p>}));
vi.mock('../widgets/DancePartyWidget/DancePartyWidget.jsx',()=>({default:()=> <p>Unguarded game body</p>}));
vi.mock('../widgets/EmulatorGame/EmulatorGameWidget.jsx',()=>({default:()=> <p>Unguarded game body</p>}));
import {getModule} from '../index.js';
afterEach(()=>vi.useRealTimers());
it.each(['jumping_jack_game','dance_party','emulator'])('all registered Fitness game routes, including %s, require Sunday admin',async id=>{
 vi.useFakeTimers();vi.setSystemTime(Date.parse('2026-11-15T09:00:00Z'));const Component=getModule(id);render(<Component/>);await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});expect(screen.queryByText('Unguarded game body')).toBeNull();expect(screen.getByRole('button',{name:'Admin unlock'})).toBeTruthy();
});
