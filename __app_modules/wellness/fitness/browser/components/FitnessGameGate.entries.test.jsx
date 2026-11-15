import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,act,fireEvent} from '@testing-library/react';
const h=vi.hoisted(()=>({api:vi.fn(),admin:vi.fn(),clear:vi.fn()}));
vi.mock('@/lib/api.mjs',async importOriginal=>({...await importOriginal(),DaylightAPI:(...args)=>h.api(...args)}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:()=>{}}));
vi.mock('../context/FitnessContext.jsx',()=>({useFitnessContext:()=>({fitnessConfiguration:{_household:'home'}})}));
vi.mock('../identity/useIdentity.js',()=>({useIdentity:()=>({registerAdmin:h.admin,clearUnlock:h.clear,unlockState:'idle'})}));
vi.mock('../widgets/CycleGame/CycleGameContainer.jsx',()=>({default:()=> <p>Actual game body</p>}));
vi.mock('../widgets/SkylineGlider/SkylineGlider.jsx',()=>({default:()=> <p>Actual game body</p>}));
vi.mock('../widgets/SkylineInvaders/SkylineInvaders.jsx',()=>({default:()=> <p>Actual game body</p>}));
import CycleGame from '../widgets/CycleGame/index.jsx';
import Glider from '../widgets/SkylineGlider/index.jsx';
import Invaders from '../widgets/SkylineInvaders/index.jsx';
afterEach(()=>vi.useRealTimers());
it.each([[CycleGame,'cycle_game'],[Glider,'skyline_glider'],[Invaders,'skyline_invaders']])('registry game export enforces Sunday before mounting %s',async(Component,moduleId)=>{
 vi.useFakeTimers();const startsAt=Date.parse('2026-11-15T08:00:00Z'),endsAt=startsAt+86400000;vi.setSystemTime(startsAt+1000);h.admin.mockResolvedValue({matched:true,userId:'parent'});h.api.mockResolvedValue({items:[{capabilityId:'fitness.games-unsupervised',subject:{kind:'household',id:'home'},period:{kind:'local_day',id:'2026-11-15',startsAt,endsAt},validFrom:startsAt,validUntil:endsAt,decision:'denied',basisState:'unsatisfied',degraded:false}]});
 render(<Component/>);await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});expect(screen.queryByText('Actual game body')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Admin unlock'}));await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});expect(h.admin).toHaveBeenLastCalledWith(moduleId);expect(screen.getByText('Actual game body')).toBeTruthy();
});
