import { expect, it, vi } from 'vitest';
import { SyncSchoolCalcDevice } from './SyncSchoolCalcDevice.mjs';

it('runs observe, queue import, delivery intents, then outbound planning in retry-safe order', async () => {
  const order = [];
  const collaborator = (name, value) => ({
    execute: vi.fn(async () => { order.push(name); return value; }),
  });
  const observe = collaborator('observe', { revision: 1 });
  const plan = collaborator('plan', { generation: 'sync-1' });
  const useCase = new SyncSchoolCalcDevice({
    profiles: collaborator('profiles', { generation: 'profiles-1', record: Buffer.from('profiles') }),
    progress: collaborator('progress', { generation: 'progress-1', record: Buffer.from('progress') }),
    observe,
    importQueue: collaborator('results', {
      accepted: 1,
      outcomes: [
        { sequence: 7, status: 'accepted', acknowledge: true },
        { sequence: 8, status: 'duplicate', acknowledge: true },
        { sequence: 9, status: 'conflict', acknowledge: false },
      ],
    }),
    requests: collaborator('requests', { requests: [
      { requestId: 10, status: 'accepted', acknowledge: true },
      { requestId: 11, status: 'conflict', acknowledge: false },
    ] }),
    interactions: collaborator('interaction', {
      request: { requestId: 12 }, response: { status: 'complete' }, record: Buffer.from('turn'),
    }),
    plan,
  });
  const outcome = await useCase.execute({
    deviceId: 'DEV', relayId: 'RELAY', rawInfo: 'info', rawState: 'state', resultQueue: 'queue',
    requestRecord: 'requests', interactionRecord: 'interaction', catalogGeneration: 'catalog-0',
  });
  expect(observe.execute).toHaveBeenCalledWith({
    deviceId: 'DEV', relayId: 'RELAY', rawInfo: 'info', rawState: 'state',
  });
  expect(order).toEqual(['profiles', 'observe', 'results', 'requests', 'interaction', 'progress', 'plan']);
  expect(plan.execute).toHaveBeenCalledWith({
    deviceId: 'DEV',
    catalogGeneration: 'catalog-0',
    acknowledgementSequences: [7, 8],
    deliveryAcknowledgementIds: [10],
    queueRecordBytes: 5,
    profileRecordBytes: 8,
    progressRecordBytes: 8,
    interactionResponseBytes: 4,
  });
  expect(outcome).toEqual({
    profiles: { generation: 'profiles-1', record: Buffer.from('profiles') },
    progress: { generation: 'progress-1', record: Buffer.from('progress') },
    observation: { revision: 1 },
    results: {
      accepted: 1,
      outcomes: [
        { sequence: 7, status: 'accepted', acknowledge: true },
        { sequence: 8, status: 'duplicate', acknowledge: true },
        { sequence: 9, status: 'conflict', acknowledge: false },
      ],
    },
    deliveries: { requests: [
      { requestId: 10, status: 'accepted', acknowledge: true },
      { requestId: 11, status: 'conflict', acknowledge: false },
    ] },
    interaction: {
      request: { requestId: 12 }, response: { status: 'complete' }, record: Buffer.from('turn'),
    },
    plan: { generation: 'sync-1' },
  });
});
