import { describe, expect, it } from 'vitest';
import { filterTi86CatalogProjection } from './ti86-catalog-access.mjs';

const access = (learnerKeys, guest = false) => ({ learnerKeys, guest });

function projection() {
  const lesson = (lessonId, rule) => ({ lessonId, title: lessonId, access: rule });
  const branch = (subjectId, rule, lessons) => ({
    subjectId, title: subjectId, access: rule,
    courses: [{ courseId: `${subjectId}-course`, access: rule, units: [{
      unitId: `${subjectId}-unit`, access: rule, lessons,
    }] }],
  });
  return {
    schema: 'school.calc.catalog-projection/v1', deviceId: '86A001',
    catalogs: [{
      catalogId: 'main', access: access([4, 9], true),
      installSets: [
        { installSetId: 'alpha', access: access([4]) },
        { installSetId: 'guest', access: access([], true) },
      ],
      subjects: [
        branch('alpha', access([4, 9], true), [lesson('a1', access([4])), lesson('shared', access([4, 9], true))]),
        branch('beta', access([9]), [lesson('b1', access([9]))]),
        branch('guest', access([], true), [lesson('g1', access([], true))]),
      ],
    }],
  };
}

describe('TI-86 offline Catalog learner filter reference', () => {
  it('retains only learner-visible branches, lessons, and complete install sets', () => {
    const filtered = filterTi86CatalogProjection(projection(), { learnerKey: 4 });
    expect(filtered.catalogs[0].subjects.map(({ subjectId }) => subjectId)).toEqual(['alpha']);
    expect(filtered.catalogs[0].subjects[0].courses[0].units[0].lessons.map(({ lessonId }) => lessonId))
      .toEqual(['a1', 'shared']);
    expect(filtered.catalogs[0].installSets.map(({ installSetId }) => installSetId)).toEqual(['alpha']);
  });

  it('applies the explicit Guest bit instead of treating Guest as a learner key', () => {
    const filtered = filterTi86CatalogProjection(projection(), { learnerKey: 0 });
    expect(filtered.catalogs[0].subjects.map(({ subjectId }) => subjectId)).toEqual(['alpha', 'guest']);
    expect(filtered.catalogs[0].subjects[0].courses[0].units[0].lessons.map(({ lessonId }) => lessonId))
      .toEqual(['shared']);
    expect(filtered.catalogs[0].installSets.map(({ installSetId }) => installSetId)).toEqual(['guest']);
  });

  it('returns an empty Catalog and fails closed on malformed access', () => {
    expect(filterTi86CatalogProjection({ catalogs: [{
      catalogId: 'private', access: access([9]), subjects: [],
    }] }, { learnerKey: 4 }).catalogs).toEqual([]);
    const malformed = projection();
    delete malformed.catalogs[0].subjects[0].access;
    expect(() => filterTi86CatalogProjection(malformed, { learnerKey: 4 }))
      .toThrow(/invalid access projection/);
  });
});
