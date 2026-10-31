import { it,expect,vi,afterEach } from 'vitest';
import { renderHook,act } from '@testing-library/react';
import { createSelectorInputRouter } from '../../lib/selectorInputRouter.js';
import { useSkylineController } from './useSkylineController.js';
afterEach(()=>vi.useRealTimers());
it('captures physical controls, keeps rider locked, and releases on unmount',()=>{
 const router=createSelectorInputRouter(),onEffect=vi.fn();
 const ctx={selectorInputRouter:router,riderSelectors:[{id:'pad',equipment:'bike',buttons:{'1_single':'child','2_long':'dad'}}],users:[{id:'child',name:'Child'},{id:'dad',name:'Dad'}],equipment:[{id:'bike',cadence:7}],getDisplayName:id=>({displayName:id}),fitnessSessionInstance:{getEquipmentCadence:()=>({rpm:0,connected:true,ts:Date.now()})}};
 const {result,unmount}=renderHook(()=>useSkylineController({ctx,courses:[{id:'one',name:'One'}],access:{unlocked:true},saveState:{status:'idle'},onEffect}));
 expect(result.current.state.riders.find(r=>r.id==='child').avatarSrc).toMatch(/\/api\/v1\/static\/img\/users\/child$/);
 act(()=>router.route({selectorId:'pad',equipmentId:'bike',action:'1_single',userId:'child'}));
 expect(result.current.state.riderId).toBe('child');expect(result.current.state.phase).toBe('flights');
 act(()=>router.route({selectorId:'pad',equipmentId:'bike',action:'2_single',userId:'someone-else'}));
 expect(result.current.state.riderId).toBe('child');
 expect(onEffect.mock.calls.filter(([e])=>e.type==='assign-rider')).toHaveLength(1);
 unmount();expect(router.route({selectorId:'pad',equipmentId:'bike',action:'1_single'})).toBe(false);
});
it('uses configured long identities and does not require double press for other riders',()=>{
 const router=createSelectorInputRouter(),ctx={selectorInputRouter:router,riderSelectors:[{id:'pad',equipment:'bike',buttons:{'1_single':'child','2_long':'dad'}}],users:[{id:'child'},{id:'dad'}],equipment:[{id:'bike',cadence:7}]};
 const {result}=renderHook(()=>useSkylineController({ctx,courses:[{id:'one'}],access:{unlocked:true},onEffect:vi.fn()}));
 act(()=>router.route({selectorId:'pad',equipmentId:'bike',action:'2_long',userId:'dad'}));
 expect(result.current.state.riderId).toBe('dad');
 act(()=>result.current.dispatch({type:'PRESS',position:3}));
 act(()=>router.route({selectorId:'pad',equipmentId:'bike',action:'4_long'}));
 expect(result.current.state.phase).toBe('roster');
});
it('releases a replaced controller and offers identity again instead of silently reassigning',()=>{
 const router=createSelectorInputRouter(),onEffect=vi.fn();
 let ctx={selectorInputRouter:router,riderSelectors:[{id:'pad',equipment:'bike',buttons:{'1_single':'child'}}],users:[{id:'child'}],equipment:[{id:'bike',cadence:7}]};
 const {result,rerender}=renderHook(()=>useSkylineController({ctx,courses:[{id:'one'}],access:{unlocked:true},onEffect}));
 act(()=>router.route({selectorId:'pad',equipmentId:'bike',action:'1_single',userId:'child'}));
 ctx={...ctx,riderSelectors:[{id:'replacement',equipment:'bike',buttons:{'1_single':'child'}}]};rerender();
 expect(result.current.state.phase).toBe('identity');
 expect(router.route({selectorId:'pad',equipmentId:'bike',action:'1_single',userId:'child'})).toBe(false);
});
