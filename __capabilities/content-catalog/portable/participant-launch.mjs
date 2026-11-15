const id = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const actions = ['open','play','queue','display'];
function fail(field) { const error = new Error(`Invalid ${field}`); error.code = 'invalid_participant_launch'; error.field = field; throw error; }
/** A typed, opaque source handle, never an authorization grant. */
export function validateParticipantLaunchRef(ref) {
  if (!obj(ref) || ref.schema !== 'participant-launch-ref/v1' || !id(ref.provider) || !id(ref.ref) || Object.keys(ref).some(k=>!['schema','provider','ref'].includes(k))) fail('ref');
  return ref;
}
/** Agenda envelope; settings remain opaque and are owned by the registered consumer. */
export function validateActivitySetup(setup) {
  if (!obj(setup) || setup.schema !== 'agenda-activity-setup/v1' || !actions.includes(setup.action)) fail('activity_setup');
  const selector = setup.participants;
  if (!obj(selector) || !['plan','explicit'].includes(selector.mode) || (selector.mode === 'explicit' && (!Array.isArray(selector.ids) || selector.ids.some(x=>!id(x)) || new Set(selector.ids).size !== selector.ids.length)) || Object.keys(selector).some(k=>!(selector.mode === 'plan' ? ['mode'] : ['mode','ids']).includes(k))) fail('participants');
  if (!obj(setup.consumer) || !id(setup.consumer.id) || !Number.isSafeInteger(setup.consumer.version) || setup.consumer.version < 1 || !Object.hasOwn(setup,'settings')) fail('consumer');
  return setup;
}
