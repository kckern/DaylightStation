import { describe, expect, it } from 'vitest';
import {
  decodeTi86ContinuationCodebook,
  encodeTi86ContinuationCodebook,
  resolveTi86ContinuationCode,
} from './Ti86ContinuationCodebook.mjs';

const catalog = {
  catalogId: 'schoolcalc-starter',
  subjects: [{ subjectId: 'arts', courses: [{ courseId: 'culture', units: [{ unitId: 'creature', lessons: [{
    lessonId: 'identify', modules: [{ moduleId: 'check', continuationCode: '098765' }],
  }] }]}]}],
};
const artifacts = [{
  artifactId: 'sc:ti86:ABCDEFG234',
  source: { address: 'schoolcalc-starter/arts/culture/creature/identify' },
}];
const learnerSlots = {
  learner1: { slot: 0, learnerKey: 1 }, learner2: { slot: 1, learnerKey: 2 },
  learner3: { slot: 2, learnerKey: 3 }, learner4: { slot: 3, learnerKey: 4 },
};

describe('TI-86 continuation-codebook adapter', () => {
  it('compiles only installed targets and resolves the shared deterministic code locally', () => {
    const record = encodeTi86ContinuationCodebook({
      deviceId: 'TI86A', generation: 'sha256:starter', catalog, artifacts, learnerSlots,
    });
    const decoded = decodeTi86ContinuationCodebook(record);
    expect(decoded).toMatchObject({ deviceId: 'TI86A', entries: expect.any(Array) });
    expect(decoded.entries).toHaveLength(4);
    expect(resolveTi86ContinuationCode(record, '123456')).toEqual(expect.objectContaining({
      learnerKey: 3, artifactKey: 'ABCDEFG234',
      address: { catalogIndex: 0, subjectIndex: 0, courseIndex: 0, unitIndex: 0, lessonIndex: 0, moduleIndex: 0 },
    }));
  });

  it('rejects a continuation target whose artifact is not installed', () => {
    expect(() => encodeTi86ContinuationCodebook({
      deviceId: 'TI86A', generation: 'sha256:starter', catalog, artifacts: [], learnerSlots,
    })).toThrow(/no installed artifact/);
  });

  it('refuses a codebook that exceeds the advertised TI-86 storage allocation', () => {
    const modules = Array.from({ length: 17 }, (_, index) => ({
      moduleId: `module-${index}`, continuationCode: String(index).padStart(6, '0'),
    }));
    const largeCatalog = {
      ...catalog,
      subjects: [{
        ...catalog.subjects[0], courses: [{
          ...catalog.subjects[0].courses[0], units: [{
            ...catalog.subjects[0].courses[0].units[0], lessons: [{
              ...catalog.subjects[0].courses[0].units[0].lessons[0], modules,
            }],
          }],
        }],
      }],
    };
    expect(() => encodeTi86ContinuationCodebook({
      deviceId: 'TI86A', generation: 'sha256:example', catalog: largeCatalog,
      artifacts, learnerSlots,
    })).toThrow(/2048-byte storage limit/);
  });
});
