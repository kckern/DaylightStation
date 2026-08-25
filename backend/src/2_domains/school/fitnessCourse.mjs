/**
 * School-owned Fitness course authoring and compilation.
 *
 * One schema covers the whole authoring range: a Plex show alone derives a
 * conventional course, while optional modules, mappings, segments and success
 * policies progressively refine that same course.  The compiled records are
 * ordinary School works/units; Fitness remains the owner of referenced media,
 * workouts, sensor streams and the resulting assessment record.
 */
import { validateUnit } from './curriculum/unitValidation.mjs';
import { validateWork } from './curriculum/workValidation.mjs';

export const FITNESS_COURSE_SCHEMA = 'school.fitness-course/v1';
export const FITNESS_ACTIVITY_PROVIDER = 'fitness';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ID = /^[a-z0-9][a-z0-9._:-]*$/i;
const SEGMENT_KINDS = new Set(['plex-video', 'saved-workout', 'sensor-block', 'voice-reflection']);
const SEGMENT_ROLES = new Set(['warmup', 'main', 'cooldown', 'drill', 'reflection']);
const OPERATORS = new Set(['eq', 'gte', 'lte', 'between']);
const METRICS = new Set([
  'segments.completed', 'segments.in_order', 'media.elapsed_seconds', 'media.completion_ratio',
  'heart_rate.coverage_ratio', 'heart_rate.average_bpm', 'heart_rate.max_bpm',
  'heart_rate.seconds_in_range', 'heart_rate.seconds_in_zone',
  'cadence.coverage_ratio', 'cadence.average_rpm', 'cadence.max_rpm', 'cadence.seconds_in_range',
  'strength.completed_steps', 'strength.planned_steps',
  'voice_memo.count', 'voice_memo.duration_seconds',
]);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string' && value.trim().length > 0;
const clone = (value) => structuredClone(value);

export function defaultFitnessSuccessPolicy() {
  return {
    all: [
      { metric: 'media.completion_ratio', op: 'gte', value: 0.5 },
      { metric: 'heart_rate.coverage_ratio', op: 'gte', value: 0.7 },
    ],
  };
}

/** Validate one authored school.fitness-course/v1 document. */
export function validateFitnessCourse(raw, ctx = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: ['fitness course must be a mapping'] };
  if (raw.schema !== FITNESS_COURSE_SCHEMA) errors.push(`schema must be ${FITNESS_COURSE_SCHEMA}`);
  if (!isString(raw.work) || !SLUG.test(raw.work)) errors.push(`work must match ${SLUG.source}`);
  else if (ctx.work && raw.work !== ctx.work) errors.push(`work is "${raw.work}" but the directory is "${ctx.work}"`);
  if (!isString(raw.title)) errors.push('title is required');
  if (!isString(raw.subject)) errors.push('subject is required');
  else if (ctx.subject && raw.subject !== ctx.subject) errors.push(`subject is "${raw.subject}" but the shelf is "${ctx.subject}"`);
  if (!isObject(raw.source)) errors.push('source is required');
  else {
    if (raw.source.adapter !== 'plex') errors.push('source.adapter must be plex');
    if (!isString(String(raw.source.showId ?? ''))) errors.push('source.showId is required');
  }
  if (raw.objectives !== undefined && (!Array.isArray(raw.objectives) || !raw.objectives.every(isString))) {
    errors.push('objectives must be an array of non-empty strings');
  }
  if (raw.grades !== undefined && (!Array.isArray(raw.grades) || !raw.grades.every(isString))) {
    errors.push('grades must be an array of non-empty strings');
  }
  validateProgression(raw.progression, errors);
  validateModules(raw.modules, errors);
  validateMapping(raw.mapping, errors);
  validateDefaults(raw.defaults, errors);
  validateAuthoredUnits(raw.units, errors);
  return errors.length ? { errors } : { errors, course: clone(raw) };
}

/**
 * Compile one authoring document and the provider's current source projection
 * into the raw work/unit records consumed by the existing School lifecycle.
 */
export function compileFitnessCourse(raw, sourceProjection, ctx = {}) {
  const validated = validateFitnessCourse(raw, ctx);
  if (validated.errors.length) return validated;
  const items = normalizeSourceItems(sourceProjection?.items ?? []);
  if (!items.length) return { errors: ['source contains no playable items'] };

  const include = new Set((raw.mapping?.include ?? []).map(String));
  const exclude = new Set((raw.mapping?.exclude ?? []).map(String));
  const selected = items.filter((item) => (!include.size || include.has(item.id)) && !exclude.has(item.id));
  if (!selected.length) return { errors: ['mapping selects no playable items'] };
  const byId = new Map(selected.map((item) => [item.id, item]));
  const errors = [];

  const courseRevision = revisionFor({ raw, sourceIds: selected.map((item) => item.id) });
  const authoredModules = Array.isArray(raw.modules) ? raw.modules : [];
  const derivedModules = deriveModules(selected);
  const modules = authoredModules.length ? authoredModules.map((module) => ({ ...module })) : derivedModules;
  const moduleIds = new Set();
  modules.forEach((module, index) => {
    if (moduleIds.has(module.module)) errors.push(`modules[${index}]: duplicate module "${module.module}"`);
    moduleIds.add(module.module);
  });
  for (const [groupIndex, group] of (raw.mapping?.groups ?? []).entries()) {
    if (!moduleIds.has(group.module)) errors.push(`mapping.groups[${groupIndex}].module "${group.module}" is not declared`);
    for (const sourceId of group.sourceIds) {
      if (!byId.has(String(sourceId))) errors.push(`mapping.groups[${groupIndex}].sourceId "${sourceId}" is not selected`);
    }
  }
  const moduleBySource = sourceModuleMap(raw.mapping, selected, modules);

  const unitSpecs = Array.isArray(raw.units) && raw.units.length
    ? raw.units
    : selected.map((item) => ({ sourceId: item.id, title: item.title }));
  const seenIds = new Set();
  const units = unitSpecs.flatMap((spec, index) => {
    const compiled = compileUnit({ raw, spec, index, byId, moduleBySource, courseRevision, errors });
    if (!compiled) return [];
    if (seenIds.has(compiled.unitId)) {
      errors.push(`units[${index}]: duplicate compiled unitId "${compiled.unitId}"`);
      return [];
    }
    seenIds.add(compiled.unitId);
    return [compiled];
  });
  if (errors.length) return { errors };

  units.forEach((unit, index) => {
    if (!moduleIds.has(unit.module)) errors.push(`units[${index}].module "${unit.module}" is not declared`);
    const videoSegments = unit.activity.segments.filter((segment) => segment.kind === 'plex-video');
    const workoutSegments = unit.activity.segments.filter((segment) => segment.kind === 'saved-workout');
    if (videoSegments.length && workoutSegments.length) {
      errors.push(`units[${index}].segments cannot mix Plex videos and a saved workout in one kiosk run`);
    }
    if (workoutSegments.length > 1) {
      errors.push(`units[${index}].segments may reference only one saved workout`);
    }
    for (const segment of unit.activity.segments) {
      if (segment.kind === 'plex-video' && !byId.has(String(segment.sourceId))) {
        errors.push(`units[${index}].segments: Plex source "${segment.sourceId}" is not selected`);
      }
    }
  });
  if (errors.length) return { errors };

  const work = {
    work: raw.work,
    title: raw.title,
    subject: raw.subject,
    category: 'course',
    medium: 'app',
    structure: { shape: 'modules', module: raw.moduleNoun ?? 'unit', items: { from: 'units', order: 'sequence' } },
    grading: { gate: 'review', scope: 'item', pass_percent: 100, exit: 'Fitness assessment passes every required gate' },
    modules,
    progression: raw.progression ?? {
      module_order: 'fixed', lesson_order: 'fixed', mode: 'sequential',
    },
  };
  const workValidation = validateWork(work, { subject: raw.subject, work: raw.work });
  errors.push(...workValidation.errors.map((error) => `work: ${error}`));
  units.forEach((unit, index) => {
    const unitValidation = validateUnit(unit, {
      activityValidators: new Map([[FITNESS_ACTIVITY_PROVIDER, validateFitnessActivityDescriptor]]),
    });
    errors.push(...unitValidation.errors.map((error) => `units[${index}]: ${error}`));
  });
  if (errors.length) return { errors };
  return { errors: [], projection: { work, units, courseRevision } };
}

function compileUnit({ raw, spec, index, byId, moduleBySource, courseRevision, errors }) {
  const sourceId = spec.sourceId != null ? String(spec.sourceId) : null;
  const source = sourceId ? byId.get(sourceId) : null;
  if (sourceId && !source) {
    errors.push(`units[${index}].sourceId "${sourceId}" is not in the selected source`);
    return null;
  }
  const localId = spec.id ?? sourceId ?? `lesson-${index + 1}`;
  const unitId = `${raw.work}.${safeId(localId)}`;
  const baseSegments = Array.isArray(spec.segments) && spec.segments.length
    ? spec.segments
    : source ? [{ id: 'main', role: 'main', kind: 'plex-video', sourceId: source.id, required: true }] : [];
  const segments = [
    ...(raw.defaults?.prepend ?? []),
    ...baseSegments,
    ...(raw.defaults?.append ?? []),
  ].map((segment, segmentIndex) => normalizeSegment(segment, segmentIndex, source));
  if (!segments.length) {
    errors.push(`units[${index}] must resolve at least one segment`);
    return null;
  }
  const successPolicy = clone(spec.success ?? raw.defaults?.success ?? defaultFitnessSuccessPolicy());
  const policyErrors = [];
  validatePolicy(successPolicy, policyErrors, `units[${index}].success`);
  errors.push(...policyErrors);
  const module = spec.module ?? (sourceId ? moduleBySource.get(sourceId) : null) ?? raw.modules?.[0]?.module ?? 'course';
  return {
    schema: 'school.unit/v1',
    unitId,
    title: spec.title ?? source?.title ?? `Lesson ${index + 1}`,
    description: spec.description ?? source?.summary ?? undefined,
    subject: raw.subject,
    objectives: spec.objectives ?? raw.objectives ?? [],
    courseId: raw.work,
    sequence: index + 1,
    module,
    moduleRole: spec.optional === true ? 'optional' : 'lesson',
    grades: spec.grades ?? raw.grades ?? [],
    passing: { percent: 100 },
    retry: { variants: 3 },
    activity: {
      provider: FITNESS_ACTIVITY_PROVIDER,
      courseRevision,
      policyRevision: revisionFor(successPolicy),
      source: { adapter: 'plex', showId: String(raw.source.showId) },
      segments,
      successPolicy,
    },
    provenance: {
      source: `Fitness provider course ${raw.source.showId}`,
      reviewState: 'approved',
      generatedBy: FITNESS_COURSE_SCHEMA,
    },
  };
}

function normalizeSourceItems(items) {
  return items.flatMap((item, index) => {
    const id = String(item.localId ?? item.plex ?? item.id ?? item.key ?? '').replace(/^[a-z]+:/i, '');
    if (!id) return [];
    return [{
      id,
      title: item.title ?? `Lesson ${index + 1}`,
      summary: item.summary ?? item.metadata?.summary ?? null,
      parentId: String(item.metadata?.parentId ?? item.parentId ?? 'course').replace(/^[a-z]+:/i, ''),
      parentTitle: item.metadata?.parentTitle ?? item.parentTitle ?? 'Course',
      parentIndex: Number(item.metadata?.parentIndex ?? item.parentIndex ?? 0),
      index: Number(item.metadata?.index ?? item.index ?? index + 1),
      durationSeconds: Number(item.duration ?? item.metadata?.duration ?? 0) || null,
    }];
  }).sort((a, b) => a.parentIndex - b.parentIndex || a.index - b.index || a.id.localeCompare(b.id));
}

function deriveModules(items) {
  const seen = new Set();
  return items.flatMap((item) => {
    if (seen.has(item.parentId)) return [];
    seen.add(item.parentId);
    return [{ module: safeSlug(item.parentId === 'course' ? 'course' : item.parentTitle), title: item.parentTitle }];
  });
}

function sourceModuleMap(mapping, items, modules) {
  const result = new Map();
  for (const group of mapping?.groups ?? []) {
    for (const sourceId of group.sourceIds ?? []) result.set(String(sourceId), group.module);
  }
  for (const item of items) {
    if (!result.has(item.id)) {
      const derived = safeSlug(item.parentId === 'course' ? 'course' : item.parentTitle);
      result.set(item.id, modules.some((module) => module.module === derived) ? derived : modules[0]?.module ?? 'course');
    }
  }
  return result;
}

function normalizeSegment(segment, index, fallbackSource) {
  const sourceId = segment.sourceId ?? (segment.kind === 'plex-video' ? fallbackSource?.id : undefined);
  return {
    id: segment.id ?? `segment-${index + 1}`,
    role: segment.role ?? (index === 0 ? 'main' : 'drill'),
    kind: segment.kind,
    required: segment.required !== false,
    ...(sourceId != null ? { sourceId: String(sourceId) } : {}),
    ...(segment.workoutId ? { workoutId: segment.workoutId } : {}),
    ...(segment.label ? { label: segment.label } : {}),
    ...(Number.isFinite(segment.durationSeconds ?? fallbackSource?.durationSeconds)
      ? { durationSeconds: segment.durationSeconds ?? fallbackSource.durationSeconds } : {}),
  };
}

function validateProgression(value, errors) {
  if (value !== undefined && !isObject(value)) errors.push('progression must be an object when present');
}

function validateModules(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length) { errors.push('modules must be a non-empty array when present'); return; }
  value.forEach((module, index) => {
    if (!isObject(module)) errors.push(`modules[${index}] must be an object`);
    else {
      if (!isString(module.module) || !SLUG.test(module.module)) errors.push(`modules[${index}].module must be a slug`);
      if (!isString(module.title)) errors.push(`modules[${index}].title is required`);
    }
  });
}

function validateMapping(value, errors) {
  if (value === undefined) return;
  if (!isObject(value)) { errors.push('mapping must be an object when present'); return; }
  for (const field of ['include', 'exclude']) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || !value[field].every((id) => isString(String(id))))) {
      errors.push(`mapping.${field} must be an array of source ids`);
    }
  }
  if (value.groups !== undefined && (!Array.isArray(value.groups) || !value.groups.every((group) => (
    isObject(group) && isString(group.module) && Array.isArray(group.sourceIds) && group.sourceIds.every((id) => isString(String(id)))
  )))) errors.push('mapping.groups must contain {module, sourceIds[]} records');
}

function validateDefaults(value, errors) {
  if (value === undefined) return;
  if (!isObject(value)) { errors.push('defaults must be an object when present'); return; }
  validateSegments(value.prepend, errors, 'defaults.prepend');
  validateSegments(value.append, errors, 'defaults.append');
  if (value.success !== undefined) validatePolicy(value.success, errors, 'defaults.success');
}

function validateAuthoredUnits(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length) { errors.push('units must be a non-empty array when present'); return; }
  value.forEach((unit, index) => {
    if (!isObject(unit)) { errors.push(`units[${index}] must be an object`); return; }
    if (unit.id !== undefined && (!isString(unit.id) || !ID.test(unit.id))) errors.push(`units[${index}].id is invalid`);
    if (unit.sourceId === undefined && (!Array.isArray(unit.segments) || !unit.segments.length)) {
      errors.push(`units[${index}] requires sourceId or segments`);
    }
    validateSegments(unit.segments, errors, `units[${index}].segments`, { plexSourceId: unit.sourceId });
    if (unit.success !== undefined) validatePolicy(unit.success, errors, `units[${index}].success`);
  });
}

function validateSegments(value, errors, field, { plexSourceId = null } = {}) {
  if (value === undefined) return;
  if (!Array.isArray(value)) { errors.push(`${field} must be an array`); return; }
  value.forEach((segment, index) => {
    const at = `${field}[${index}]`;
    if (!isObject(segment)) { errors.push(`${at} must be an object`); return; }
    if (!SEGMENT_KINDS.has(segment.kind)) errors.push(`${at}.kind is unsupported`);
    if (segment.role !== undefined && !SEGMENT_ROLES.has(segment.role)) errors.push(`${at}.role is unsupported`);
    if (segment.required !== undefined && typeof segment.required !== 'boolean') errors.push(`${at}.required must be boolean`);
    if (segment.kind === 'plex-video' && !isString(String(segment.sourceId ?? plexSourceId ?? ''))) errors.push(`${at}.sourceId is required for plex-video`);
    if (segment.kind === 'saved-workout' && !isString(segment.workoutId)) errors.push(`${at}.workoutId is required for saved-workout`);
  });
}

export function validateFitnessSuccessPolicy(policy) {
  const errors = [];
  validatePolicy(policy, errors, 'successPolicy');
  return { errors };
}

/** Provider validator injected into School's generic activity composition. */
export function validateFitnessActivityDescriptor(activity) {
  const errors = [];
  if (!isObject(activity)) return ['activity must be an object'];
  if (activity.provider !== FITNESS_ACTIVITY_PROVIDER) errors.push('activity.provider must be fitness');
  if (!isString(activity.courseRevision)) errors.push('activity.courseRevision is required');
  if (!isString(activity.policyRevision)) errors.push('activity.policyRevision is required');
  if (!Array.isArray(activity.segments) || !activity.segments.length) errors.push('activity.segments must be non-empty');
  else validateSegments(activity.segments, errors, 'activity.segments');
  validatePolicy(activity.successPolicy, errors, 'activity.successPolicy');
  return errors;
}

function validatePolicy(node, errors, at) {
  if (!isObject(node)) { errors.push(`${at} must be an object`); return; }
  const combinators = ['all', 'any', 'atLeast'].filter((key) => node[key] !== undefined);
  if (combinators.length > 1) { errors.push(`${at} must use one combinator`); return; }
  if (node.all !== undefined || node.any !== undefined) {
    const key = node.all !== undefined ? 'all' : 'any';
    if (!Array.isArray(node[key]) || !node[key].length) errors.push(`${at}.${key} must be a non-empty array`);
    else node[key].forEach((child, index) => validatePolicy(child, errors, `${at}.${key}[${index}]`));
    return;
  }
  if (node.atLeast !== undefined) {
    if (!isObject(node.atLeast) || !Number.isInteger(node.atLeast.count) || node.atLeast.count < 1
      || !Array.isArray(node.atLeast.of) || node.atLeast.of.length < node.atLeast.count) {
      errors.push(`${at}.atLeast requires count and a sufficiently large of[]`);
    } else node.atLeast.of.forEach((child, index) => validatePolicy(child, errors, `${at}.atLeast.of[${index}]`));
    return;
  }
  if (!METRICS.has(node.metric)) errors.push(`${at}.metric is unsupported`);
  if (!OPERATORS.has(node.op)) errors.push(`${at}.op must be eq|gte|lte|between`);
  if (node.op === 'between') {
    if (!Array.isArray(node.value) || node.value.length !== 2 || !node.value.every(Number.isFinite)) errors.push(`${at}.value must be [min,max]`);
  } else if (!Number.isFinite(node.value) && typeof node.value !== 'boolean') errors.push(`${at}.value must be numeric or boolean`);
  if (node.range !== undefined && (!Array.isArray(node.range) || node.range.length !== 2 || !node.range.every(Number.isFinite))) {
    errors.push(`${at}.range must be [min,max]`);
  }
  if (node.zone !== undefined && !isString(node.zone)) errors.push(`${at}.zone must be a string`);
  if (['heart_rate.seconds_in_range', 'cadence.seconds_in_range'].includes(node.metric) && node.range === undefined) {
    errors.push(`${at}.range is required for ${node.metric}`);
  }
  if (node.metric === 'heart_rate.seconds_in_zone' && !isString(node.zone)) {
    errors.push(`${at}.zone is required for heart_rate.seconds_in_zone`);
  }
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'lesson';
}
function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'course';
}

/** Deterministic, dependency-free revision for frozen course/policy snapshots. */
export function revisionFor(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `f${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
