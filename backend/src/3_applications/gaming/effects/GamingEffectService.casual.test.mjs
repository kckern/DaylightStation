import { expect, it, vi } from 'vitest';
import { GamingEffectService } from './GamingEffectService.mjs';
it('records casual turn completion without generating AI judgments or commentary', async () => {
  const propose = vi.fn(async () => 'Winner!'); const audit = vi.fn(); const broadcast = vi.fn();
  const service = new GamingEffectService({aiPolicy:{propose}, observability:{increment(){}, audit}, broadcast});
  await service.afterCommit({sessionId:'game:casual', command:{command:{type:'challenge.finish'}}, viewer:{role:'host'}, result:{header:{ruleset:{id:'activity-party'},revision:1}, state:{competition:false}, events:[{event:{type:'challenge.finished'},event_id:'finish'}]}});
  expect(audit).toHaveBeenCalledOnce();
  expect(propose).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});
