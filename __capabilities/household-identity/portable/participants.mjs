/** Pure, serializable participant values. No consumer-specific fields belong here. */
const id = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(field, message) { const error = new Error(message); error.code = 'invalid_participant_context'; error.field = field; throw error; }
function exactKeys(value, allowed, path = '') {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path ? `${path}.${key}` : key, 'Unexpected field');
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value) && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  fail('value', 'Expected a JSON value');
}
export function validateParticipantSelector(selector) {
  if (!object(selector) || selector.schema !== 'participant-selector/v1') fail('selector', 'Invalid selector schema');
  if (selector.mode === 'all' && Object.keys(selector).every(k => ['schema','mode'].includes(k))) return selector;
  if (selector.mode !== 'explicit' || !Array.isArray(selector.keys) || selector.keys.some(k => !id(k)) || new Set(selector.keys).size !== selector.keys.length || Object.keys(selector).some(k => !['schema','mode','keys'].includes(k))) fail('selector.keys', 'Invalid explicit selector');
  return selector;
}
function validateRoster(roster) {
  if (!Array.isArray(roster)) fail('participants', 'Expected a roster');
  const keys = new Set(), runtime = new Set(), refs = new Set();
  roster.forEach((p, i) => {
    const path = `participants.${i}`;
    if (!object(p) || !id(p.key) || !id(p.participant_id) || keys.has(p.key) || runtime.has(p.participant_id)) fail(path, 'Invalid or duplicate participant key or runtime identity');
    exactKeys(p, ['key','participant_id','identity','display'], path);
    keys.add(p.key); runtime.add(p.participant_id);
    const identity = p.identity;
    if (!object(identity)) fail(`${path}.identity`, 'Identity required');
    if (identity.kind === 'user' || identity.kind === 'guest') {
      if (!id(identity.id) || Object.keys(identity).some(k => !['kind','id'].includes(k))) fail(`${path}.identity`, 'Invalid named identity');
      const expected = identity.kind === 'guest' ? `guest:${identity.id}` : identity.id;
      if (p.participant_id !== expected) fail(`${path}.participant_id`, 'Runtime identity does not match person');
      const ref = `${identity.kind}:${identity.id}`;
      if (refs.has(ref)) fail(`${path}.identity`, 'Duplicate named identity');
      refs.add(ref);
    } else if (identity.kind === 'anonymous') {
      if (!id(identity.scope_id) || !id(identity.slot_id) || Object.keys(identity).some(k => !['kind','scope_id','slot_id'].includes(k))) fail(`${path}.identity`, 'Invalid anonymous identity');
      if (p.participant_id !== `anon:${identity.scope_id}:${identity.slot_id}`) fail(`${path}.participant_id`, 'Runtime identity does not match anonymous identity');
    } else fail(`${path}.identity.kind`, 'Unknown identity kind');
    if (!object(p.display) || typeof p.display.name !== 'string' || !p.display.name.trim() || p.display.name.length > 256 || !Object.hasOwn(p.display,'avatar') || (p.display.avatar !== null && (!object(p.display.avatar) || !id(p.display.avatar.kind)))) fail(`${path}.display`, 'Invalid display snapshot');
    exactKeys(p.display, ['name','avatar'], `${path}.display`);
    const avatar = p.display.avatar;
    if (avatar !== null) {
      const avatarPath = `${path}.display.avatar`;
      const field = avatar.kind === 'user-avatar' ? 'userId' : 'id';
      exactKeys(avatar, ['kind',field], avatarPath);
      if (!id(avatar[field]) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(avatar[field]) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(avatar.kind)) fail(avatarPath, 'Invalid semantic avatar reference');
    }
    canonical(p);
  });
}
export function selectParticipants({roster, selector}) {
  validateRoster(roster); validateParticipantSelector(selector);
  if (selector.mode === 'all') return structuredClone(roster);
  const byKey = new Map(roster.map(p => [p.key,p]));
  return selector.keys.map((key, i) => { if (!byKey.has(key)) fail(`selector.keys.${i}`, 'Unknown participant key'); return structuredClone(byKey.get(key)); });
}
export function validateParticipantContext(context) {
  if (!object(context) || context.schema !== 'participant-context/v1' || !id(context.context_id)) fail('context', 'Invalid participant context');
  exactKeys(context, ['schema','context_id','scope','participants']);
  const scope = context.scope;
  if (!object(scope) || !id(scope.provider) || !id(scope.id) || !Number.isSafeInteger(scope.revision) || scope.revision < 0) fail('scope', 'Invalid participant scope');
  exactKeys(scope, ['provider','id','revision'], 'scope');
  validateRoster(context.participants); canonical(context); return context;
}
/** SHA-256 of the canonical scope and ordered participant snapshots. */
export async function createParticipantContext({scope, participants}) {
  const value = {schema:'participant-context/v1',scope:structuredClone(scope),participants:structuredClone(participants)};
  validateParticipantContext({...value,context_id:'pending'});
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return {...value,context_id:`pc_${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('')}`};
}
