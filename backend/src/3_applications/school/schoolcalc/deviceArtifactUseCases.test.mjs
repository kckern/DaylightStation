import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { EnrollSchoolCalcDevice } from './EnrollSchoolCalcDevice.mjs';
import { ObserveSchoolCalcDevice } from './ObserveSchoolCalcDevice.mjs';
import { BuildSchoolCalcArtifact } from './BuildSchoolCalcArtifact.mjs';
import { GetSchoolCalcArtifact } from './GetSchoolCalcArtifact.mjs';

class MemoryDevices {
  records = new Map();
  async getDevice(id) { return this.records.get(id) ?? null; }
  async saveDevice(device, { expectedRevision } = {}) {
    const prior = this.records.get(device.deviceId);
    if (expectedRevision === null && prior) throw new Error('already exists');
    if (expectedRevision !== null && expectedRevision !== undefined && prior?.revision !== expectedRevision) throw new Error('revision conflict');
    this.records.set(device.deviceId, device);
    return device;
  }
}

function fakeCodec() {
  return {
    platformId: 'future',
    encodeDeviceIdentity: vi.fn(({ deviceId }) => Buffer.from(`ID:${deviceId}`)),
    encodeLearnerRoster: vi.fn(() => Buffer.from('USERS')),
    describeCapabilities: vi.fn(() => ({
      platformId: 'future', deviceId: 'DEV001', shellVersion: '1', capabilities: ['reader@1'],
      installedArtifactIds: [], limits: { maxArtifactBytes: 9999 },
    })),
    supports: vi.fn(() => ({ compatible: true, reasons: [] })),
    compile: vi.fn((bundle) => ({
      artifactId: 'sc:future:ARTIFACT', platformId: 'future', variableName: 'LESSON',
      bytes: Buffer.from('artifact'), byteLength: 8, byteDigest: 'bytes', sourceDigest: 'source',
      source: { address: bundle.address, lessonId: bundle.lesson.lessonId, moduleIds: ['notes'] },
    })),
  };
}

describe('SchoolCalc device and artifact use cases', () => {
  it('enrolls, provisions, and observes through an injected future-family codec', async () => {
    const devices = new MemoryDevices();
    const codec = fakeCodec();
    const codecs = { get: (id) => { expect(id).toBe('future'); return codec; } };
    const enroll = new EnrollSchoolCalcDevice({
      devices, codecs, deviceIdFactory: async () => 'DEV001',
      learners: {
        listLearners: async () => [{ id: 'user_4', name: 'Alpha' }],
        hasLearner: async (id) => id === 'user_4',
      },
      clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });
    const created = await enroll.execute({ platformId: 'future', label: 'Future A', catalogId: 'main' });
    expect(created.device).toMatchObject({
      deviceId: 'DEV001', platformId: 'future', catalogId: 'main',
      learnerBindings: [expect.objectContaining({ learnerKey: 1, learnerId: 'user_4' })],
    });
    expect(created.identityRecord.toString()).toBe('ID:DEV001');
    expect(created.learnerRoster.record.toString()).toBe('USERS');

    const observed = await new ObserveSchoolCalcDevice({
      devices, codecs, clock: () => new Date('2026-08-01T12:05:00.000Z'),
    }).execute({
      deviceId: 'DEV001', rawInfo: Buffer.from('info'), rawState: Buffer.from('state'), relayId: 'relay-a',
    });
    expect(observed).toMatchObject({ revision: 2, lastRelayId: 'relay-a', capabilityReport: { shellVersion: '1' } });
    expect(codec.describeCapabilities).toHaveBeenCalledWith(Buffer.from('info'), Buffer.from('state'));
  });

  it('does not enroll a calculator without its one Catalog assignment', async () => {
    const enroll = new EnrollSchoolCalcDevice({
      devices: new MemoryDevices(), codecs: { get: () => fakeCodec() }, deviceIdFactory: async () => 'DEV001',
      learners: { listLearners: async () => [] }, clock: () => new Date('2026-08-01T12:00:00.000Z'),
    });
    await expect(enroll.execute({ platformId: 'future', label: 'Future A' })).rejects.toThrow(/catalogId/);
  });

  it('compiles only in the build use case, stores interpretation metadata, and GET never compiles', async () => {
    const devices = new MemoryDevices();
    devices.records.set('DEV001', SchoolCalcDevice.enroll({
      deviceId: 'DEV001', label: 'Future A', platformId: 'future', catalogId: 'main', createdAt: 'now',
    }).observe({
      capabilityReport: { platformId: 'future', deviceId: 'DEV001', installedArtifactIds: [] },
      observedAt: 'later', relayId: 'relay-a',
    }));
    const codec = fakeCodec();
    const artifacts = {
      value: null,
      async putArtifact(artifact) { this.value ??= artifact; return this.value; },
      async getArtifact(id) { return this.value?.artifactId === id ? this.value : null; },
    };
    const bundles = { execute: vi.fn(async () => ({
      schema: 'school.learning-lesson/v1', address: 'main/a/b/c/d', context: {},
      lesson: { lessonId: 'd', modules: [{ moduleId: 'notes' }] }, capabilities: ['reader@1'],
    })) };
    const built = await new BuildSchoolCalcArtifact({
      devices, codecs: { get: () => codec }, bundles, artifacts,
    }).execute({ deviceId: 'DEV001', address: 'main/a/b/c/d' });
    expect(built.interpretation.bundle.lesson.lessonId).toBe('d');
    expect(codec.compile).toHaveBeenCalledTimes(1);
    expect(codec.compile).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'main/a/b/c/d' }),
      expect.objectContaining({ platformId: 'future' }),
      { sourceBundle: expect.objectContaining({ address: 'main/a/b/c/d' }) },
    );

    const fetched = await new GetSchoolCalcArtifact({ artifacts }).execute({ artifactId: built.artifactId });
    expect(fetched.bytes.toString()).toBe('artifact');
    expect(codec.compile).toHaveBeenCalledTimes(1);
  });
});
