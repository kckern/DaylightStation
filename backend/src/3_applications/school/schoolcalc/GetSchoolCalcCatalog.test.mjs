import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { GetSchoolCalcCatalog } from './GetSchoolCalcCatalog.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

const catalog = {
  schema: 'school.catalog/v1', catalogId: 'main', title: 'Main',
  installSets: [{
    installSetId: 'mixed-starter', title: 'Mixed starter',
    lessonAddresses: ['main/mixed/course/unit/ready', 'main/mixed/course/unit/special'],
  }],
  subjects: [{ subjectId: 'mixed', title: 'Mixed', courses: [{
    courseId: 'course', title: 'Course', units: [{ unitId: 'unit', title: 'Unit', lessons: [
      { lessonId: 'ready', title: 'Ready', modules: [{ moduleId: 'notes', type: 'lecture_notes', documentId: 'ready-doc' }] },
      { lessonId: 'special', title: 'Special', modules: [{ moduleId: 'custom', type: 'custom', capability: 'special-view@1', config: {} }] },
    ] }],
  }] }],
};

function bundle(lessonId) {
  const special = lessonId === 'special';
  return {
    schema: 'school.learning-lesson/v1',
    address: `main/mixed/course/unit/${lessonId}`,
    context: {},
    lesson: { lessonId, title: lessonId, modules: [{ moduleId: special ? 'custom' : 'notes', type: special ? 'custom' : 'lecture_notes' }] },
    capabilities: [special ? 'special-view@1' : 'reader@1'],
  };
}

describe('GetSchoolCalcCatalog', () => {
  it('preserves authored hierarchy/order and annotates compatibility/install state', async () => {
    const readyBundle = bundle('ready');
    const artifact = {
      artifactId: 'sc:future:READY', source: { address: readyBundle.address },
      sourceDigest: stableRecordDigest(readyBundle), byteLength: 321,
    };
    const observed = SchoolCalcDevice.enroll({
      deviceId: 'DEV001', label: 'Device', platformId: 'future', catalogId: 'main', createdAt: 'now',
    }).observe({
      capabilityReport: {
        platformId: 'future', deviceId: 'DEV001', capabilities: ['reader@1'],
        installedArtifactIds: [artifact.artifactId], limits: {
          freeBytes: 5000,
          maxArtifactBytes: 1000,
          artifactTargetBytes: 800,
          catalogStateTargetBytes: 400,
          catalogStateMaxBytes: 600,
          catalogRecordTargetBytes: 350,
          catalogRecordMaxBytes: 550,
          queueTargetBytes: 400,
          queueMaxBytes: 600,
          reservedFreeBytes: 900,
          variableOverheadBytes: 12,
        },
      },
      observedAt: 'later', relayId: 'relay',
    });
    const device = observed.synchronizeLearners({
      learners: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
      synchronizedAt: 'sync-time',
    }).device;
    const encodeCatalog = vi.fn(() => Buffer.from('catalog-record'));
    const useCase = new GetSchoolCalcCatalog({
      devices: { getDevice: async () => device },
      catalogs: { getCatalog: async () => catalog },
      bundles: { execute: async ({ lessonId }) => bundle(lessonId) },
      codecs: { get: () => ({
        supports: (value, report) => ({
          compatible: value.capabilities.every((required) => report.capabilities.includes(required)),
          reasons: value.capabilities.filter((required) => !report.capabilities.includes(required)).map((required) => `missing capability ${required}`),
        }),
        encodeCatalog,
      }) },
      artifacts: { getArtifact: async (id) => id === artifact.artifactId ? artifact : null },
      access: { resolve: async () => ({
        learners: [
          { learnerId: 'alpha', lessonAddresses: ['main/mixed/course/unit/ready'] },
          { learnerId: 'beta', lessonAddresses: ['main/mixed/course/unit/special'] },
        ],
        guest: { lessonAddresses: [] },
      }) },
    });
    const result = await useCase.execute({ deviceId: 'DEV001' });
    const lessons = result.catalogs[0].subjects[0].courses[0].units[0].lessons;
    expect(lessons.map((lesson) => lesson.lessonId)).toEqual(['ready', 'special']);
    expect(lessons[0]).toMatchObject({ state: 'installed', compatible: true, artifactId: artifact.artifactId, byteLength: 321 });
    expect(lessons[1]).toMatchObject({ state: 'incompatible', compatible: false, reasons: ['missing capability special-view@1'] });
    expect(lessons.map(({ access }) => access)).toEqual([
      { learnerKeys: [1], guest: false },
      { learnerKeys: [2], guest: false },
    ]);
    expect(result.catalogs[0].access).toEqual({ learnerKeys: [1, 2], guest: false });
    expect(result.catalogs[0].subjects[0].access).toEqual({ learnerKeys: [1, 2], guest: false });
    expect(result.catalogs[0].subjects[0].courses[0].access).toEqual({ learnerKeys: [1, 2], guest: false });
    expect(result.catalogs[0].subjects[0].courses[0].units[0].access)
      .toEqual({ learnerKeys: [1, 2], guest: false });
    expect(result.catalogs[0].installSets[0]).toMatchObject({
      installSetId: 'mixed-starter',
      artifactCount: 2,
      artifactIds: [artifact.artifactId],
      byteLength: null,
      compatible: false,
      state: 'incompatible',
      lessonAddresses: ['main/mixed/course/unit/ready', 'main/mixed/course/unit/special'],
      members: [
        { address: 'main/mixed/course/unit/ready', state: 'installed', artifactId: artifact.artifactId, byteLength: 321 },
        { address: 'main/mixed/course/unit/special', state: 'incompatible', artifactId: null, byteLength: null },
      ],
    });
    expect(result.catalogs[0].installSets[0].versionId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.catalogs[0].installSets[0].reasons).toEqual([
      'main/mixed/course/unit/special: missing capability special-view@1',
    ]);
    expect(result.generation).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.storage).toEqual({
      freeBytes: 5000,
      maxArtifactBytes: 1000,
      artifactTargetBytes: 800,
      catalogStateTargetBytes: 400,
      catalogStateMaxBytes: 600,
      catalogRecordTargetBytes: 350,
      catalogRecordMaxBytes: 550,
      queueTargetBytes: 400,
      queueMaxBytes: 600,
      queueMaxRecords: null,
      deliveryRequestTargetBytes: null,
      deliveryRequestMaxBytes: null,
      deliveryRequestMaxRecords: null,
      learnerRosterTargetBytes: null,
      learnerRosterMaxBytes: null,
      learnerRosterMaxRecords: null,
      progressProjectionTargetBytes: null,
      progressProjectionMaxBytes: null,
      acknowledgementMaxBytes: null,
      syncManifestMaxBytes: null,
      reservedFreeBytes: 900,
      variableOverheadBytes: 12,
      localStateCommitBytes: 0,
      catalogCommitCopyCount: 0,
      manifestCommitCopyCount: 0,
      queueCommitCopyCount: 0,
    });
    expect(result.record.toString()).toBe('catalog-record');
    expect(encodeCatalog).toHaveBeenCalledWith(expect.objectContaining({ generation: result.generation }));
  });

  it('does not compile artifacts while projecting Catalog', async () => {
    const compile = vi.fn();
    const device = SchoolCalcDevice.enroll({ deviceId: 'DEV001', label: 'D', platformId: 'future', catalogId: 'main', createdAt: 'now' })
      .observe({
        capabilityReport: { platformId: 'future', deviceId: 'DEV001', capabilities: ['reader@1'], installedArtifactIds: [], limits: {} },
        observedAt: 'later', relayId: 'relay',
      });
    await new GetSchoolCalcCatalog({
      devices: { getDevice: async () => device },
      catalogs: { getCatalog: async () => catalog },
      bundles: { execute: async ({ lessonId }) => bundle(lessonId) },
      codecs: { get: () => ({ supports: () => ({ compatible: true, reasons: [] }), encodeCatalog: () => Buffer.alloc(0), compile }) },
      artifacts: { getArtifact: async () => null },
      access: { resolve: async ({ learners, lessons }) => ({
        learners: learners.map(({ learnerId }) => ({
          learnerId, lessonAddresses: lessons.map(({ address }) => address),
        })),
        guest: { lessonAddresses: lessons.map(({ address }) => address) },
      }) },
    }).execute({ deviceId: 'DEV001' });
    expect(compile).not.toHaveBeenCalled();
  });

  it('projects the device-assigned Catalog while other Catalogs remain published for other devices', async () => {
    const device = SchoolCalcDevice.enroll({ deviceId: 'DEV001', label: 'D', platformId: 'future', catalogId: 'main', createdAt: 'now' })
      .observe({
        capabilityReport: { platformId: 'future', deviceId: 'DEV001', capabilities: [], installedArtifactIds: [], limits: {} },
        observedAt: 'later', relayId: 'relay',
      });
    const secondCatalog = {
      ...catalog,
      catalogId: 'second',
      installSets: catalog.installSets.map((installSet) => ({
        ...installSet,
        lessonAddresses: installSet.lessonAddresses.map((address) => address.replace(/^main\//, 'second/')),
      })),
    };
    const getCatalog = vi.fn(async (catalogId) => (catalogId === 'main' ? catalog : secondCatalog));
    const useCase = new GetSchoolCalcCatalog({
      devices: { getDevice: async () => device },
      catalogs: { getCatalog },
      bundles: { execute: async ({ lessonId }) => bundle(lessonId) },
      codecs: { get: () => ({ supports: () => ({ compatible: true, reasons: [] }), encodeCatalog: () => Buffer.alloc(0) }) },
      artifacts: { getArtifact: async () => null },
      access: { resolve: async ({ learners, lessons }) => ({
        learners: learners.map(({ learnerId }) => ({ learnerId, lessonAddresses: lessons.map(({ address }) => address) })),
        guest: { lessonAddresses: lessons.map(({ address }) => address) },
      }) },
    });
    const result = await useCase.execute({ deviceId: 'DEV001' });
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(getCatalog).toHaveBeenCalledWith('main');
    expect(result.catalogs.map(({ catalogId }) => catalogId)).toEqual(['main']);
  });
});
