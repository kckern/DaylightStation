import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { RequestSchoolCalcDelivery } from './RequestSchoolCalcDelivery.mjs';

function observedDevice({ learners = [{ id: 'user_4', name: 'Alpha' }] } = {}) {
  const observed = SchoolCalcDevice.enroll({ deviceId: 'DEV001', label: 'D', platformId: 'future', catalogId: 'main', createdAt: 'created' })
    .observe({
      capabilityReport: { platformId: 'future', deviceId: 'DEV001', installedArtifactIds: ['sc:future:OLD'] },
      observedAt: 'observed', relayId: 'relay',
    });
  return observed.synchronizeLearners({ learners, synchronizedAt: 'synchronized' }).device;
}

function catalogProjection({ lessonLearnerKeys = [1], lessonGuest = false, setLearnerKeys = [1], setGuest = false } = {}) {
  return {
    catalogs: [{
      catalogId: 'main',
      installSets: [{ installSetId: 'starter', access: { learnerKeys: setLearnerKeys, guest: setGuest } }],
      subjects: [{ subjectId: 'a', courses: [{ courseId: 'b', units: [{ unitId: 'c', lessons: [{
        lessonId: 'd', address: 'main/a/b/c/d',
        access: { learnerKeys: lessonLearnerKeys, guest: lessonGuest },
      }] }] }] }],
    }],
  };
}

describe('RequestSchoolCalcDelivery', () => {
  it('compiles only new installs and applies install/remove intent as one device revision save', async () => {
    let device = observedDevice();
    const saveDevice = vi.fn(async (next, { expectedRevision }) => {
      expect(expectedRevision).toBe(device.revision);
      device = next;
    });
    const buildArtifact = { execute: vi.fn(async () => ({ artifactId: 'sc:future:NEW' })) };
    const record = Buffer.from('requests');
    const codec = { decodeDeliveryRequests: vi.fn(() => ({
      deviceId: 'DEV001',
      requests: [
        { schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 1, learnerKey: 1, action: 'install', address: 'main/a/b/c/d' },
        { schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 2, learnerKey: 1, action: 'remove', artifactId: 'sc:future:OLD' },
      ],
    })) };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => device, saveDevice }, codecs: { get: () => codec }, buildArtifact,
      catalog: { execute: vi.fn(async () => catalogProjection()) },
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });
    const result = await useCase.execute({ deviceId: 'DEV001', record });
    expect(result.requests.map(({ status }) => status)).toEqual(['accepted', 'accepted']);
    expect(result.requests.every(({ acknowledge }) => acknowledge === true)).toBe(true);
    expect(result.desiredArtifactIds).toEqual(['sc:future:NEW']);
    expect(buildArtifact.execute).toHaveBeenCalledTimes(1);
    expect(saveDevice).toHaveBeenCalledTimes(1);

    const replay = await useCase.execute({ deviceId: 'DEV001', record });
    expect(replay.requests.map(({ status }) => status)).toEqual(['duplicate', 'duplicate']);
    expect(replay.requests.every(({ acknowledge }) => acknowledge === true)).toBe(true);
    expect(buildArtifact.execute).toHaveBeenCalledTimes(1);
    expect(saveDevice).toHaveBeenCalledTimes(1);
  });

  it('rejects a batch claiming another device before compiling', async () => {
    const buildArtifact = { execute: vi.fn() };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => observedDevice() },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'OTHER', requests: [{}] }) }) },
      catalog: { execute: vi.fn() },
      buildArtifact,
    });
    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) })).rejects.toThrow(/does not match endpoint/);
    expect(buildArtifact.execute).not.toHaveBeenCalled();
  });

  it('resolves a logical install set to several artifacts and saves the intent atomically', async () => {
    let device = observedDevice();
    const saveDevice = vi.fn(async (next) => { device = next; });
    const buildInstallSet = { execute: vi.fn(async () => ({
      artifactIds: ['sc:future:ONE', 'sc:future:TWO'],
    })) };
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 3, learnerKey: 1,
      action: 'install', installSet: { catalogId: 'main', installSetId: 'starter' },
    };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => device, saveDevice },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests: [request] }) }) },
      catalog: { execute: vi.fn(async () => catalogProjection()) },
      buildArtifact: { execute: vi.fn() },
      buildInstallSet,
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });

    const result = await useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) });
    expect(result.requests[0]).toMatchObject({
      status: 'accepted', artifactIds: ['sc:future:ONE', 'sc:future:TWO'],
    });
    expect(result.desiredArtifactIds).toEqual(['sc:future:OLD', 'sc:future:ONE', 'sc:future:TWO']);
    expect(buildInstallSet.execute).toHaveBeenCalledWith({
      deviceId: 'DEV001', catalogId: 'main', installSetId: 'starter',
    });
    expect(saveDevice).toHaveBeenCalledTimes(1);
  });

  it('rejects an install outside the selected learner Catalog before compilation', async () => {
    const buildArtifact = { execute: vi.fn() };
    const saveDevice = vi.fn();
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 4, learnerKey: 1,
      action: 'install', address: 'main/a/b/c/d',
    };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => observedDevice(), saveDevice },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests: [request] }) }) },
      catalog: { execute: vi.fn(async () => catalogProjection({ lessonLearnerKeys: [] })) },
      buildArtifact,
    });

    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) }))
      .rejects.toThrow(/not available to learnerKey 1/);
    expect(buildArtifact.execute).not.toHaveBeenCalled();
    expect(saveDevice).not.toHaveBeenCalled();
  });

  it('preflights the whole batch before compiling any earlier authorized install', async () => {
    const buildArtifact = { execute: vi.fn(async () => ({ artifactId: 'sc:future:NEW' })) };
    const requests = [
      {
        schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 40, learnerKey: 1,
        action: 'install', address: 'main/a/b/c/d',
      },
      {
        schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 41, learnerKey: 2,
        action: 'remove', artifactId: 'sc:future:OLD',
      },
    ];
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => observedDevice(), saveDevice: vi.fn() },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests }) }) },
      catalog: { execute: vi.fn(async () => catalogProjection()) },
      buildArtifact,
    });

    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) }))
      .rejects.toThrow(/learnerKey 2 is not active/);
    expect(buildArtifact.execute).not.toHaveBeenCalled();
  });

  it('uses the explicit Guest Catalog policy for a Guest install', async () => {
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 5, learnerKey: 0,
      action: 'install', address: 'main/a/b/c/d',
    };
    const buildArtifact = { execute: vi.fn(async () => ({ artifactId: 'sc:future:GUEST' })) };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => observedDevice(), saveDevice: vi.fn() },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests: [request] }) }) },
      catalog: { execute: vi.fn(async () => catalogProjection({ lessonGuest: true })) },
      buildArtifact,
    });

    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) })).resolves.toMatchObject({
      requests: [{ status: 'accepted', learnerKey: 0 }],
    });
    expect(buildArtifact.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a retired learner key for a new request', async () => {
    const retired = observedDevice().synchronizeLearners({ learners: [], synchronizedAt: 'retired' }).device;
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 6, learnerKey: 1,
      action: 'remove', artifactId: 'sc:future:OLD',
    };
    const catalog = { execute: vi.fn() };
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => retired, saveDevice: vi.fn() },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests: [request] }) }) },
      catalog,
      buildArtifact: { execute: vi.fn() },
    });

    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) }))
      .rejects.toThrow(/learnerKey 1 is not active/);
    expect(catalog.execute).not.toHaveBeenCalled();
  });

  it('keeps an accepted replay idempotent after its learner binding retires', async () => {
    let device = observedDevice();
    const request = {
      schema: 'school.calc.delivery-request/v1', deviceId: 'DEV001', requestId: 7, learnerKey: 1,
      action: 'install', address: 'main/a/b/c/d',
    };
    const buildArtifact = { execute: vi.fn(async () => ({ artifactId: 'sc:future:NEW' })) };
    const catalog = { execute: vi.fn(async () => catalogProjection()) };
    const saveDevice = vi.fn(async (next) => { device = next; });
    const useCase = new RequestSchoolCalcDelivery({
      devices: { getDevice: async () => device, saveDevice },
      codecs: { get: () => ({ decodeDeliveryRequests: () => ({ deviceId: 'DEV001', requests: [request] }) }) },
      catalog,
      buildArtifact,
    });
    await useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) });
    device = device.synchronizeLearners({ learners: [], synchronizedAt: 'retired' }).device;

    await expect(useCase.execute({ deviceId: 'DEV001', record: Buffer.alloc(0) })).resolves.toMatchObject({
      requests: [{ status: 'duplicate', learnerKey: 1 }],
    });
    expect(buildArtifact.execute).toHaveBeenCalledTimes(1);
    expect(catalog.execute).toHaveBeenCalledTimes(1);
  });
});
