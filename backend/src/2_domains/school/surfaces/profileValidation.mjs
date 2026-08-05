import { validateCapabilityList } from '../catalog/capabilities.mjs';
import { isRegisteredCapability } from './capabilityRegistry.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export const SURFACE_FAMILIES = Object.freeze(['schoolcalc', 'paper', 'screen']);
const LIVENESS = Object.freeze(['static', 'observed']);

/** Pure validation for school.surface-profile/v1 (spec §4.1). */
export function validateSurfaceProfile(raw, { customCapabilities = [] } = {}) {
  if (!isObject(raw)) return { errors: ['surface profile must be a mapping'] };
  const errors = [];
  if (raw.schema !== 'school.surface-profile/v1') errors.push('schema must be school.surface-profile/v1');
  if (!ID.test(raw.surfaceId || '')) errors.push('surfaceId must be a lowercase identifier');
  if (!SURFACE_FAMILIES.includes(raw.family)) errors.push(`family must be ${SURFACE_FAMILIES.join('|')}`);
  if (!isText(raw.title)) errors.push('title is required');
  if (!LIVENESS.includes(raw.liveness)) errors.push(`liveness must be ${LIVENESS.join('|')}`);

  const list = validateCapabilityList(raw.capabilities, { path: 'capabilities', required: true });
  errors.push(...list.errors);
  for (const id of list.capabilities) {
    if (!isRegisteredCapability(id, { customCapabilities })) {
      errors.push(`capabilities: '${id}' is not a registered capability`);
    }
  }
  if (raw.limits !== undefined && !isObject(raw.limits)) errors.push('limits must be a mapping');

  if (errors.length) return { errors };
  return {
    errors,
    profile: Object.freeze({
      schema: raw.schema, surfaceId: raw.surfaceId, family: raw.family,
      title: raw.title, liveness: raw.liveness,
      capabilities: Object.freeze([...list.capabilities]),
      limits: Object.freeze(structuredClone(raw.limits ?? {})),
    }),
  };
}
