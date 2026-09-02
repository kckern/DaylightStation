import { describe, expect, it } from 'vitest';
import { SchoolCalcDevice } from './SchoolCalcDevice.mjs';

function enrolled() {
  return SchoolCalcDevice.enroll({
    deviceId: '86A001', label: 'TI-86 A', platformId: 'ti86', catalogId: 'main',
    createdAt: '2026-08-01T12:00:00.000Z',
  });
}

const report = {
  platformId: 'ti86', deviceId: '86A001', shellVersion: '0.1.0',
  capabilities: ['reader@1'], installedArtifactIds: ['sc:ti86:OLD234ABCD'],
  limits: { freeBytes: 50000, maxArtifactBytes: 12288 },
};

describe('SchoolCalcDevice aggregate', () => {
  it('requires one durable Catalog assignment at enrollment', () => {
    expect(() => SchoolCalcDevice.enroll({
      deviceId: '86A001', label: 'TI-86 A', platformId: 'ti86', createdAt: 'now',
    })).toThrow(/catalogId/);
  });

  it('keeps device identity separate from learner bindings and adopts the first observed install set', () => {
    const device = enrolled().observe({
      capabilityReport: report, observedAt: '2026-08-01T12:05:00.000Z', relayId: 'relay-1',
    });
    expect(device.deviceId).toBe('86A001');
    expect(device.learnerBindings).toEqual([]);
    expect(device.installedArtifactIds).toEqual(['sc:ti86:OLD234ABCD']);
    expect(device.desiredArtifactIds).toEqual(['sc:ti86:OLD234ABCD']);
    expect(device.revision).toBe(1);
  });

  it('assigns stable non-recycled learner keys and retains retired bindings for old queues', () => {
    const first = enrolled().synchronizeLearners({
      learners: [{ id: 'user_4', name: 'Alpha' }, { id: 'user_2', name: 'Beta' }],
      synchronizedAt: '2026-08-01T12:01:00.000Z',
    });
    expect(first.changed).toBe(true);
    expect(first.device.activeLearnerBindings).toEqual([
      expect.objectContaining({ learnerKey: 1, learnerId: 'user_4', position: 0, active: true }),
      expect.objectContaining({ learnerKey: 2, learnerId: 'user_2', position: 1, active: true }),
    ]);

    const second = first.device.synchronizeLearners({
      learners: [{ id: 'user_2', name: 'Beta B' }, { id: 'user_5', name: 'Gamma' }],
      synchronizedAt: '2026-08-02T12:01:00.000Z',
    });
    expect(second.device.activeLearnerBindings).toEqual([
      expect.objectContaining({ learnerKey: 2, learnerId: 'user_2', label: 'Beta B', position: 0 }),
      expect.objectContaining({ learnerKey: 3, learnerId: 'user_5', position: 1 }),
    ]);
    expect(second.device.resolveLearnerKey(1)).toMatchObject({ learnerId: 'user_4', active: false });
    expect(second.device.resolveLearnerKey(1, { activeOnly: true })).toBeNull();

    const third = second.device.synchronizeLearners({
      learners: [{ id: 'user_4', name: 'Alpha' }, { id: 'user_2', name: 'Beta B' }],
      synchronizedAt: '2026-08-03T12:01:00.000Z',
    });
    expect(third.device.activeLearnerBindings.map(({ learnerKey }) => learnerKey)).toEqual([1, 2]);
    expect(third.device.resolveLearnerKey(3)).toMatchObject({ learnerId: 'user_5', active: false });
    expect(third.device.synchronizeLearners({
      learners: [{ id: 'user_4', name: 'Alpha' }, { id: 'user_2', name: 'Beta B' }],
      synchronizedAt: '2026-08-04T12:01:00.000Z',
    })).toMatchObject({ changed: false, device: third.device });
  });

  it('rejects duplicate configured learners instead of creating ambiguous attribution', () => {
    expect(() => enrolled().synchronizeLearners({
      learners: [{ id: 'user_4', name: 'Alpha' }, { id: 'user_4', name: 'Again' }],
      synchronizedAt: '2026-08-01T12:01:00.000Z',
    })).toThrow(/repeats/);
  });

  it('applies idempotent install intent and rejects changed request reuse', () => {
    const device = enrolled().observe({ capabilityReport: report, observedAt: 'now', relayId: 'relay-1' });
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 7, learnerKey: 1,
      action: 'install', address: 'main/markets/finance/interest/compound-growth',
    };
    const accepted = device.requestDelivery({
      request, recordDigest: 'digest-a', resolvedArtifactIds: ['sc:ti86:NEW234ABCD'], requestedAt: 'later',
    });
    expect(accepted.outcome).toBe('accepted');
    expect(accepted.device.desiredArtifactIds).toEqual(['sc:ti86:OLD234ABCD', 'sc:ti86:NEW234ABCD']);
    expect(accepted.device.requestDelivery({
      request, recordDigest: 'digest-a', resolvedArtifactIds: ['sc:ti86:NEW234ABCD'], requestedAt: 'later',
    }).outcome).toBe('duplicate');
    expect(() => accepted.device.requestDelivery({
      request, recordDigest: 'digest-b', resolvedArtifactIds: ['sc:ti86:NEW234ABCD'], requestedAt: 'later',
    })).toThrow(/reused with different content/);
  });

  it('applies a multi-artifact install or removal as one aggregate revision', () => {
    const device = enrolled().observe({ capabilityReport: report, observedAt: 'now', relayId: 'relay-1' });
    const install = device.requestDelivery({
      request: {
        schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 8, learnerKey: 1,
        action: 'install', installSet: { catalogId: 'main', installSetId: 'starter' },
      },
      recordDigest: 'set-install',
      resolvedArtifactIds: ['sc:ti86:ONE234ABCD', 'sc:ti86:TWO234ABCD'],
      requestedAt: 'later',
    });
    expect(install.entry.artifactIds).toEqual(['sc:ti86:ONE234ABCD', 'sc:ti86:TWO234ABCD']);
    expect(install.device.desiredArtifactIds).toEqual([
      'sc:ti86:OLD234ABCD', 'sc:ti86:ONE234ABCD', 'sc:ti86:TWO234ABCD',
    ]);

    const remove = install.device.requestDelivery({
      request: {
        schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 9, learnerKey: 1,
        action: 'remove', artifactIds: ['sc:ti86:ONE234ABCD', 'sc:ti86:TWO234ABCD'],
      },
      recordDigest: 'set-remove',
      requestedAt: 'still-later',
    });
    expect(remove.device.desiredArtifactIds).toEqual(['sc:ti86:OLD234ABCD']);
    expect(remove.device.revision).toBe(3);
  });

  it('does not accept an observation for another platform or calculator', () => {
    expect(() => enrolled().observe({
      capabilityReport: { ...report, platformId: 'ti89' }, observedAt: 'now', relayId: 'relay-1',
    })).toThrow(/platform does not match/);
    expect(() => enrolled().observe({
      capabilityReport: { ...report, deviceId: '86B002' }, observedAt: 'now', relayId: 'relay-1',
    })).toThrow(/identity does not match/);
  });
});
