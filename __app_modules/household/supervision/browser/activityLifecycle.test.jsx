import {describe,it,expect} from 'vitest';
import {registerActivityStop,suspendActivities} from './activityLifecycle.js';
describe('activity lifecycle suspension',()=>{
 it('stops detached owner audio even if another consumer throws',()=>{
  const reward={playing:true};const bad=registerActivityStop(()=>{throw Error('broken consumer');});
  const good=registerActivityStop(()=>{reward.playing=false;});
  suspendActivities({epoch:1,reason:'parent'});expect(reward.playing).toBe(false);bad();good();
 });
});
