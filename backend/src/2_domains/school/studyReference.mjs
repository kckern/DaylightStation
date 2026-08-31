/**
 * Learner-facing physical-book references used by worksheet lesson cards and
 * missed-question remediation. These are study aids for original parallel
 * practice, not claims that a question was copied from the named page.
 */

const DIGITAL_SIDECAR = /\b(?:EPUB|PDF|MOBI|HTML)\b|\.(?:epub|pdf|mobi|html?)\b/iu;
const STUDY_ROLES = new Set(['primary', 'alternate']);
const MAX_REFERENCES = 3;
const MAX_PAGES_PER_REFERENCE = 12;

const isMapping = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function validateMaterialReference(raw, path, { withRole }) {
  const errors = [];
  if (!isMapping(raw)) return { errors: [`${path} must be a mapping`], reference: null };
  const allowed = new Set(withRole ? ['role', 'title', 'pages', 'section'] : ['title', 'pages', 'section']);
  const unknown = Object.keys(raw).filter((field) => !allowed.has(field));
  if (unknown.length) errors.push(`${path} has unknown fields: ${unknown.join(', ')}`);

  const title = text(raw.title);
  const section = text(raw.section);
  if (!title) errors.push(`${path}.title must be a non-empty string`);
  else if (DIGITAL_SIDECAR.test(title)) errors.push(`${path}.title must name a physical book, not a digital sidecar`);
  if (!section) errors.push(`${path}.section must be a non-empty string`);

  let pages = null;
  if (!Array.isArray(raw.pages) || raw.pages.length === 0 || raw.pages.length > MAX_PAGES_PER_REFERENCE) {
    errors.push(`${path}.pages must contain 1..${MAX_PAGES_PER_REFERENCE} printed page numbers`);
  } else if (raw.pages.some((page) => !Number.isInteger(page) || page < 1)) {
    errors.push(`${path}.pages must contain positive integers`);
  } else if (new Set(raw.pages).size !== raw.pages.length) {
    errors.push(`${path}.pages must not contain duplicates`);
  } else {
    pages = [...raw.pages].sort((left, right) => left - right);
  }

  let role;
  if (withRole) {
    if (!STUDY_ROLES.has(raw.role)) errors.push(`${path}.role must be primary|alternate`);
    else role = raw.role;
  }
  return {
    errors,
    reference: errors.length ? null : { ...(withRole ? { role } : {}), title, pages, section },
  };
}

export function validateStudyReferences(raw, path = 'studyReferences') {
  if (raw === undefined || raw === null) return { errors: [], references: null };
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REFERENCES) {
    return { errors: [`${path} must contain 1..${MAX_REFERENCES} references`], references: null };
  }
  const results = raw.map((entry, index) => validateMaterialReference(entry, `${path}[${index}]`, { withRole: true }));
  const errors = results.flatMap((result) => result.errors);
  const references = results.map((result) => result.reference).filter(Boolean);
  const primaryCount = references.filter((reference) => reference.role === 'primary').length;
  if (primaryCount !== 1) errors.push(`${path} must contain exactly one primary reference`);
  if (references[0]?.role !== 'primary') errors.push(`${path}[0] must be the primary reference`);
  const identities = references.map((reference) => `${reference.title}\0${reference.pages.join(',')}\0${reference.section}`);
  if (new Set(identities).size !== identities.length) errors.push(`${path} must not contain duplicate references`);
  return { errors, references: errors.length ? null : references };
}

export function validateReviewReference(raw, path = 'reviewReference') {
  if (raw === undefined || raw === null) return { errors: [], reference: null };
  return validateMaterialReference(raw, path, { withRole: false });
}
