/**
 * Pure validation + normalisation of a syllabus (see
 * docs/reference/school/enrollment.md §4). No I/O.
 *
 * A syllabus is a saved, named, reusable set of arguments to
 * `createCourseEnrollment` — which course, at what profile, under what
 * ordering policy, against what pass bar. It holds no learner: an ENROLLMENT
 * maps a learner to a syllabus, and materializes the result onto the
 * learner's assignment entry.
 *
 * Reference checks are ADVISORY IN POSTURE, the same rule `SetAssignments`
 * holds to: when the caller cannot supply the reference set, they are skipped
 * (a broken catalog must not lock syllabus edits shut), but a set that IS
 * supplied and does not know the id is a refusal that names the ghost.
 */
export const SYLLABUS_SCHEMA = 'school.syllabus/v1';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ORDERINGS = ['sequence', 'shuffle_once'];
const POLICY_KEYS = ['module_order', 'lesson_order', 'required_opening_module'];

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;

/**
 * @param {*} raw - one parsed syllabus record
 * @param {{courseIds?: Set<string>, profileIds?: Set<string>}} [sets]
 *   `profileIds` are the profiles the NAMED COURSE authors (`work.profiles`).
 * @returns {{errors: string[], syllabus?: object}}
 */
export function validateSyllabus(raw, sets = {}) {
  if (!isObj(raw)) return { errors: ['syllabus must be a mapping'] };
  const errors = [];

  if (raw.schema !== SYLLABUS_SCHEMA) errors.push(`schema must be ${SYLLABUS_SCHEMA}`);

  if (!isText(raw.syllabusId)) errors.push('syllabusId is required');
  else if (!SLUG.test(raw.syllabusId)) errors.push(`syllabusId must match ${SLUG.source}, got: ${raw.syllabusId}`);

  if (!isText(raw.title)) errors.push('title is required');

  if (!isText(raw.courseId)) {
    errors.push('courseId is required');
  } else if (sets.courseIds?.size && !sets.courseIds.has(raw.courseId)) {
    errors.push(`unknown course: '${raw.courseId}' is not in the published catalog`);
  }

  // Wave 1 is whole-course only: the planner takes membership from the catalog
  // (planner.mjs:90-95) and computes module completion over ALL catalog
  // siblings (planner.mjs:137-138), so a subset would be silently ignored.
  // Refuse the field rather than store data nothing honors.
  if (isPresent(raw.modules)) {
    errors.push('modules is not supported yet — a syllabus covers its whole course');
  }

  let profile = null;
  if (isPresent(raw.profile)) {
    if (!isText(raw.profile)) errors.push('profile must be a non-empty string');
    else if (sets.profileIds?.size && !sets.profileIds.has(raw.profile)) {
      errors.push(`unknown profile: '${raw.profile}' is not offered by ${raw.courseId}`);
    } else profile = raw.profile;
  }

  let policy = null;
  if (isPresent(raw.policy)) {
    if (!isObj(raw.policy)) {
      errors.push('policy must be an object');
    } else {
      const unknown = Object.keys(raw.policy).filter((k) => !POLICY_KEYS.includes(k));
      if (unknown.length) errors.push(`policy has unknown keys: ${unknown.join(', ')}`);
      ['module_order', 'lesson_order'].forEach((key) => {
        if (isPresent(raw.policy[key]) && !ORDERINGS.includes(raw.policy[key])) {
          errors.push(`policy.${key} must be ${ORDERINGS.join('|')}, got: ${raw.policy[key]}`);
        }
      });
      if (isPresent(raw.policy.required_opening_module) && !isText(raw.policy.required_opening_module)) {
        errors.push('policy.required_opening_module must be a non-empty string');
      }
      if (!unknown.length) policy = raw.policy;
    }
  }

  let passing = null;
  if (isPresent(raw.passing)) {
    if (!Number.isInteger(raw.passing) || raw.passing < 1 || raw.passing > 100) {
      errors.push('passing must be an integer between 1 and 100');
    } else passing = raw.passing;
  }

  let term = null;
  if (isPresent(raw.term)) {
    if (!isText(raw.term)) errors.push('term must be a non-empty string');
    else term = raw.term;
  }

  if (errors.length) return { errors };
  return {
    errors,
    syllabus: {
      schema: SYLLABUS_SCHEMA,
      syllabusId: raw.syllabusId,
      title: raw.title,
      courseId: raw.courseId,
      profile,
      policy,
      passing,
      term,
    },
  };
}

export default validateSyllabus;
