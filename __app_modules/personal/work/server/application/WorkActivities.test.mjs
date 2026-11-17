import { it, expect, afterEach, vi } from 'vitest';
import { WorkActivities } from './WorkActivities.mjs';
import { harness, commit, ref, item } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
const event = {
  id: 'work:sample',
  username: 'sample',
  ref,
  containerRef: item().containerRef,
  type: 'completed',
  occurredAt: AS_OF,
  observedAt: AS_OF,
  providerVersion: 'v1',
  occurrenceId: String(AS_OF),
  origin: 'provider',
  causationId: null,
  sourceRefs: ['provider:sample'],
  actorId: null,
  occurredAtEstimated: false
};
it('replays projection after lost ACK and retries KB without another projection/provider effect', async () => {
  const h = harness();
  resources.push(h);
  const store = h.make();
  await commit(store, 'event', [{
    type: 'activity.observed',
    event
  }]);
  const projected = new Map();
  const activityStore = {
    upsert: vi.fn(async ({
      event
    }) => {
      const applied = !projected.has(event.id);
      projected.set(event.id, event);
      return {
        applied,
        eventId: event.id
      };
    })
  };
  let failAck = true;
  const state = {
    read: input => store.read(input),
    transact: input => {
      if (failAck && input.events.some(e => e.type === 'activity.projected')) throw new Error('lost ACK');
      return store.transact(input);
    }
  };
  const bridge = {
    applyProviderEvent: vi.fn(async () => {
      throw new Error('KB unavailable');
    })
  };
  const service = new WorkActivities({
    state,
    activityStore,
    knowledgeBridge: bridge,
    clock: () => AS_OF
  });
  expect((await service.flush({
    username: 'sample',
    asOf: AS_OF
  })).pending).toBe(1);
  expect(projected.size).toBe(1);
  failAck = false;
  expect((await service.flush({
    username: 'sample',
    asOf: AS_OF
  })).pending).toBe(1);
  expect(projected.size).toBe(1);
  bridge.applyProviderEvent.mockResolvedValue({
    applied: false,
    reason: 'policy_blocked'
  });
  expect((await service.flush({
    username: 'sample',
    asOf: AS_OF
  })).pending).toBe(0);
  expect(projected.size).toBe(1);
  expect(activityStore.upsert).toHaveBeenCalledTimes(2);
});
