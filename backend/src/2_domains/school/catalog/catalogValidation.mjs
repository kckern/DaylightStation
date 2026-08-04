import { capabilityForLearningModule, validateLearningModule } from './moduleValidation.mjs';
import { validateCapabilityList } from './capabilities.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LESSON_ADDRESS = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){4}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function validateHeader(raw, kind, idField, path, errors) {
  if (!isObject(raw)) { errors.push(`${path}: ${kind} must be a mapping`); return false; }
  if (!ID.test(raw[idField] || '')) errors.push(`${path}.${idField}: must be a lowercase identifier`);
  if (!isText(raw.title)) errors.push(`${path}.title: is required`);
  if (raw.shortTitle !== undefined && !isText(raw.shortTitle)) errors.push(`${path}.shortTitle: must be non-empty when present`);
  if (raw.description !== undefined && !isText(raw.description)) errors.push(`${path}.description: must be non-empty when present`);
  if (raw.estimatedMinutes !== undefined && (!Number.isInteger(raw.estimatedMinutes) || raw.estimatedMinutes < 1 || raw.estimatedMinutes > 1440)) {
    errors.push(`${path}.estimatedMinutes: must be an integer from 1–1440 when present`);
  }
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || !raw.tags.every(isText) || new Set(raw.tags).size !== raw.tags.length)) {
    errors.push(`${path}.tags: must be unique non-empty strings when present`);
  }
  for (const field of ['areaIds', 'classifications']) {
    if (raw[field] !== undefined && (!Array.isArray(raw[field])
        || raw[field].some((value) => typeof value !== 'string' || !ID.test(value))
        || new Set(raw[field]).size !== raw[field].length)) {
      errors.push(`${path}.${field}: must be unique lowercase identifiers when present`);
    }
  }
  return true;
}

function validateUniqueList(list, { path, childName, idField, validate }, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${path}: must be a non-empty array`);
    return;
  }
  const seen = new Set();
  list.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    validate(entry, at, errors);
    const id = entry?.[idField];
    if (typeof id !== 'string') return;
    if (seen.has(id)) errors.push(`${at}.${idField}: duplicate ${childName} '${id}'`);
    else seen.add(id);
  });
}

function validateLesson(raw, path, errors) {
  if (!validateHeader(raw, 'lesson', 'lessonId', path, errors)) return;
  if (raw.objectives !== undefined && (!Array.isArray(raw.objectives) || raw.objectives.length === 0 || !raw.objectives.every(isText))) {
    errors.push(`${path}.objectives: must be a non-empty array of non-empty strings`);
  }
  errors.push(...validateCapabilityList(raw.requiredCapabilities, {
    path: `${path}.requiredCapabilities`,
  }).errors);
  validateUniqueList(raw.modules, {
    path: `${path}.modules`, childName: 'module', idField: 'moduleId',
    validate(module, at, target) { target.push(...validateLearningModule(module, { path: at }).errors); },
  }, errors);
}

function validateUnit(raw, path, errors) {
  if (!validateHeader(raw, 'unit', 'unitId', path, errors)) return;
  validateUniqueList(raw.lessons, { path: `${path}.lessons`, childName: 'lesson', idField: 'lessonId', validate: validateLesson }, errors);
}

function validateCourse(raw, path, errors) {
  if (!validateHeader(raw, 'course', 'courseId', path, errors)) return;
  validateUniqueList(raw.units, { path: `${path}.units`, childName: 'unit', idField: 'unitId', validate: validateUnit }, errors);
}

function validateSubject(raw, path, errors) {
  if (!validateHeader(raw, 'subject', 'subjectId', path, errors)) return;
  validateUniqueList(raw.courses, { path: `${path}.courses`, childName: 'course', idField: 'courseId', validate: validateCourse }, errors);
}

function validateInstallSet(raw, path, errors) {
  if (!validateHeader(raw, 'install set', 'installSetId', path, errors)) return;
  if (!Array.isArray(raw.lessonAddresses) || raw.lessonAddresses.length === 0) {
    errors.push(`${path}.lessonAddresses: must be a non-empty array`);
    return;
  }
  const seen = new Set();
  raw.lessonAddresses.forEach((address, index) => {
    const at = `${path}.lessonAddresses[${index}]`;
    if (typeof address !== 'string' || !LESSON_ADDRESS.test(address)) {
      errors.push(`${at}: must contain catalog/subject/course/unit/lesson IDs`);
    } else if (seen.has(address)) {
      errors.push(`${at}: duplicate lesson address '${address}'`);
    } else {
      seen.add(address);
    }
  });
}

/** Pure validation of the greenfield, data-driven School Catalog. */
export function validateLearningCatalog(raw) {
  const errors = [];
  if (!isObject(raw)) return { errors: ['catalog must be a mapping'] };
  if (raw.schema !== 'school.catalog/v1') errors.push('schema must be school.catalog/v1');
  validateHeader(raw, 'catalog', 'catalogId', 'catalog', errors);
  validateUniqueList(raw.subjects, { path: 'subjects', childName: 'subject', idField: 'subjectId', validate: validateSubject }, errors);
  if (raw.installSets !== undefined) {
    validateUniqueList(raw.installSets, {
      path: 'installSets', childName: 'install set', idField: 'installSetId', validate: validateInstallSet,
    }, errors);
  }
  if (errors.length === 0 && raw.installSets !== undefined) {
    const known = new Set(listCatalogLessons(raw).map(({ address }) => address));
    raw.installSets.forEach((installSet, setIndex) => {
      installSet.lessonAddresses.forEach((address, addressIndex) => {
        if (!known.has(address)) {
          errors.push(`installSets[${setIndex}].lessonAddresses[${addressIndex}]: unknown lesson '${address}'`);
        }
      });
    });
  }
  return errors.length ? { errors } : { errors, catalog: raw };
}

export function lessonAddress({ catalogId, subjectId, courseId, unitId, lessonId }) {
  return [catalogId, subjectId, courseId, unitId, lessonId].join('/');
}

/** Flatten the authored tree without losing its context or order. */
export function listCatalogLessons(catalog) {
  const out = [];
  (catalog?.subjects || []).forEach((subject, subjectIndex) => {
    subject.courses.forEach((course, courseIndex) => {
      course.units.forEach((unit, unitIndex) => {
        unit.lessons.forEach((lesson, lessonIndex) => {
          const context = {
            catalogId: catalog.catalogId, subjectId: subject.subjectId,
            courseId: course.courseId, unitId: unit.unitId, lessonId: lesson.lessonId,
          };
          out.push({
            address: lessonAddress(context), context,
            order: { subject: subjectIndex, course: courseIndex, unit: unitIndex, lesson: lessonIndex },
            subject, course, unit, lesson,
            capabilities: [...new Set([
              ...lesson.modules.map(capabilityForLearningModule).filter(Boolean),
              ...(lesson.requiredCapabilities ?? []),
            ])],
          });
        });
      });
    });
  });
  return out;
}

/** Delivery grouping is orthogonal to the pedagogical tree. */
export function listCatalogInstallSets(catalog) {
  return (catalog?.installSets ?? []).map((installSet) => structuredClone(installSet));
}

/** Resolve one authored lesson and retain every level of its catalog context. */
export function findCatalogLesson(catalog, { subjectId, courseId, unitId, lessonId }) {
  return listCatalogLessons(catalog).find((entry) => (
    entry.context.subjectId === subjectId
    && entry.context.courseId === courseId
    && entry.context.unitId === unitId
    && entry.context.lessonId === lessonId
  )) ?? null;
}
