/**
 * Host reference for SCCAT's offline learner filter. It mirrors the Z80 rule:
 * key zero reads `guest`; a durable learner key must occur in `learnerKeys`.
 * Every retained branch contains at least one retained descendant.
 */
export function filterTi86CatalogProjection(projection, { learnerKey } = {}) {
  if (!projection || !Array.isArray(projection.catalogs)) {
    throw new Error('TI-86 Catalog projection must contain catalogs');
  }
  if (!Number.isInteger(learnerKey) || learnerKey < 0 || learnerKey > 0xffff) {
    throw new Error('TI-86 Catalog learnerKey must be a 16-bit non-negative integer');
  }
  const catalogs = projection.catalogs
    .filter((catalog) => allows(catalog, learnerKey))
    .map((catalog) => {
      const subjects = catalog.subjects
        .filter((subject) => allows(subject, learnerKey))
        .map((subject) => {
          const courses = subject.courses
            .filter((course) => allows(course, learnerKey))
            .map((course) => {
              const units = course.units
                .filter((unit) => allows(unit, learnerKey))
                .map((unit) => ({
                  ...structuredClone(unit),
                  lessons: unit.lessons
                    .filter((lesson) => allows(lesson, learnerKey))
                    .map((lesson) => structuredClone(lesson)),
                }));
              return { ...structuredClone(course), units };
            });
          return { ...structuredClone(subject), courses };
        });
      return {
        ...structuredClone(catalog),
        installSets: (catalog.installSets ?? [])
          .filter((installSet) => allows(installSet, learnerKey))
          .map((installSet) => structuredClone(installSet)),
        subjects,
      };
    });
  return Object.freeze({ ...structuredClone(projection), catalogs: Object.freeze(catalogs) });
}

function allows(node, learnerKey) {
  const access = node?.access;
  if (!access || !Array.isArray(access.learnerKeys)
      || access.learnerKeys.some((key) => !Number.isInteger(key) || key < 1 || key > 0xffff)
      || typeof access.guest !== 'boolean') {
    throw new Error('TI-86 Catalog node has an invalid access projection');
  }
  return learnerKey === 0 ? access.guest : access.learnerKeys.includes(learnerKey);
}

export default filterTi86CatalogProjection;
