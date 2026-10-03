/**
 * Routine catalog — which routines start playback on which screen
 * (RQ-AUTO-02, RQ-AUTO-05, RQ-HOUSE-06/08 warnings).
 *
 * Routines today are Home Assistant automations and scripts that end in a
 * REST call to `GET /api/v1/device/<id>/load?<query>`. This module reads the
 * parsed HA config (rest commands, scripts, automations — plain objects, no
 * I/O) and follows each automation → script → rest command chain to the
 * screen it targets and the load query it sends, substituting the variables
 * passed along the way (`query: queue=morning-program` into
 * `load?{{ query | default(...) }}`).
 *
 * Targets are stable ids (`fleet:<devices.yml key>`), so a renamed screen
 * keeps its routines.
 *
 * @module domains/media/routineCatalog
 */

const LOAD_URL = /\/api\/v1\/device\/([A-Za-z0-9._-]+)\/(.*)$/;
const TEMPLATE = /\{\{\s*([A-Za-z_]\w*)\s*(?:\|\s*default\(\s*(['"])(.*?)\2\s*\))?[^}]*\}\}/g;
const IGNORED_PARAMS = new Set(['dispatchId', 'prewarmShuffle', 'routine', 'triggerId']);
const KIND_RANK = { automation: 0.3, script: 0.2, command: 0.1, observed: 0 };
const MAX_DEPTH = 8;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Fill `{{ name | default('x') }}` from vars, else its default, else leave it. */
function substitute(text, vars) {
  if (typeof text !== 'string') return text;
  return text.replace(TEMPLATE, (match, name, _q, fallback) => {
    const value = vars?.[name];
    if (value !== undefined && value !== null && typeof value !== 'object') return String(value);
    return fallback !== undefined ? fallback : match;
  });
}

function substituteDeep(value, vars) {
  if (typeof value === 'string') return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, vars));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteDeep(v, vars)]));
  return value;
}

/**
 * A load query string → params. Template values become '*' (any); a query
 * that is itself a template is unknown (null).
 * @param {string} query
 * @returns {Object<string,string>|null}
 */
export function parseLoadQuery(query) {
  if (typeof query !== 'string') return null;
  const text = query.replace(/^\?/, '').trim();
  if (!text) return {};
  if (/^\{\{[^}]*\}\}$/.test(text)) return null;
  const out = {};
  for (const part of text.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq >= 0 ? part.slice(0, eq) : part;
    const rawValue = eq >= 0 ? part.slice(eq + 1) : '';
    let key = rawKey;
    let value = rawValue;
    try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    try { value = decodeURIComponent(rawValue.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    if (key.includes('{{')) return null;
    out[key] = value.includes('{{') ? '*' : value;
  }
  return out;
}

function restCommandInfo(restCommands) {
  const info = {};
  for (const [name, command] of Object.entries(isObject(restCommands) ? restCommands : {})) {
    const url = isObject(command) ? command.url : null;
    if (typeof url !== 'string') continue;
    const match = url.match(LOAD_URL);
    if (!match) continue;
    const [, screenId, rest] = match;
    if (/^load(\?|$)/.test(rest)) {
      info[name] = { screenId, mode: 'fixed', query: rest.replace(/^load\??/, '') };
    } else if (/^\{\{[^}]*\}\}/.test(rest)) {
      info[name] = { screenId, mode: 'action', template: rest };
    }
  }
  return info;
}

function serviceOf(node) {
  const value = node.service ?? node.action;
  return typeof value === 'string' ? value.trim() : null;
}

function scriptTargetsOf(node) {
  const entity = node.target?.entity_id ?? node.entity_id ?? node.data?.entity_id;
  const list = Array.isArray(entity) ? entity : (typeof entity === 'string' ? entity.split(',') : []);
  return list.map((e) => String(e).trim()).filter((e) => e.startsWith('script.')).map((e) => e.slice(7));
}

/** Plain (non-object) `variables:` values; templates among them stay as text. */
function plainVars(variables) {
  if (!isObject(variables)) return {};
  return Object.fromEntries(Object.entries(variables).filter(([, v]) => v !== null && typeof v !== 'object'));
}

function scriptDefaults(script) {
  const out = {};
  for (const [name, field] of Object.entries(isObject(script?.fields) ? script.fields : {})) {
    if (isObject(field) && field.default !== undefined) out[name] = field.default;
  }
  return out;
}

/**
 * Walk an action tree, collecting load targets.
 * @returns {Array<{screenId, query, via: string[]}>}
 */
function walk(node, ctx, vars, via, depth, stack) {
  if (depth > MAX_DEPTH || node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap((child) => walk(child, ctx, vars, via, depth, stack));
  if (!isObject(node)) return [];
  const out = [];
  const service = serviceOf(node);
  const data = substituteDeep(isObject(node.data) ? node.data : {}, vars);
  if (service?.startsWith('rest_command.')) {
    const name = service.slice('rest_command.'.length);
    const info = ctx.rest[name];
    if (info) {
      ctx.usedRest.add(name);
      const path = [...via, `rest_command:${name}`];
      if (info.mode === 'fixed') {
        out.push({ screenId: info.screenId, query: substitute(info.query, data), via: path });
      } else {
        const action = substitute(substitute(info.template, data), vars);
        if (typeof action === 'string' && /^load(\?|$)/.test(action)) {
          out.push({ screenId: info.screenId, query: action.replace(/^load\??/, ''), via: path });
        }
      }
    }
  } else if (service?.startsWith('script.')) {
    const called = service === 'script.turn_on'
      ? scriptTargetsOf(node).map((name) => [name, isObject(data.variables) ? data.variables : {}])
      : [[service.slice('script.'.length), data]];
    for (const [name, passed] of called) {
      const script = ctx.scripts[name];
      if (!isObject(script) || stack.includes(name)) continue;
      const scriptVars = { ...scriptDefaults(script), ...plainVars(script.variables), ...passed };
      out.push(...walk(script.sequence, ctx, scriptVars, [...via, `script:${name}`], depth + 1, [...stack, name]));
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'data' || key === 'target' || key === 'variables' || key === 'service' || key === 'action') continue;
    if (Array.isArray(value) || isObject(value)) out.push(...walk(value, ctx, vars, via, depth + 1, stack));
  }
  // `action:` doubles as the list key for automations in newer HA syntax.
  if (Array.isArray(node.action)) out.push(...walk(node.action, ctx, vars, via, depth + 1, stack));
  return out;
}

function toTargets(raw) {
  const seen = new Set();
  const targets = [];
  for (const t of raw) {
    const key = `${t.screenId}|${t.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ deviceId: `fleet:${t.screenId}`, screenId: t.screenId, query: t.query });
  }
  return targets;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed';
}

/**
 * @param {{restCommands?: Object, scripts?: Object, automations?: Array}} config - parsed HA config
 * @returns {Array<{id, name, kind:'automation'|'script'|'command', source:'home-assistant',
 *   targets: Array<{deviceId, screenId, query}>, via: string[]}>}
 */
export function extractRoutines({ restCommands = {}, scripts = {}, automations = [] } = {}) {
  const ctx = {
    rest: restCommandInfo(restCommands),
    scripts: isObject(scripts) ? scripts : {},
    usedRest: new Set(),
  };
  const routines = [];
  for (const automation of Array.isArray(automations) ? automations : []) {
    if (!isObject(automation)) continue;
    // Automation-level `variables:` are in scope for every action below.
    const raw = walk(automation.actions ?? automation.action ?? automation.sequence, ctx, plainVars(automation.variables), [], 0, []);
    if (!raw.length) continue;
    const key = automation.id ?? slug(automation.alias ?? '');
    routines.push({
      id: `automation:${key}`, name: automation.alias || String(key), kind: 'automation', source: 'home-assistant',
      targets: toTargets(raw), via: raw[0].via,
    });
  }
  for (const [name, script] of Object.entries(ctx.scripts)) {
    if (!isObject(script)) continue;
    const raw = walk(script.sequence, ctx, { ...scriptDefaults(script), ...plainVars(script.variables) }, [], 0, [name]);
    if (!raw.length) continue;
    routines.push({
      id: `script:${name}`, name: script.alias || name, kind: 'script', source: 'home-assistant',
      targets: toTargets(raw), via: raw[0].via,
    });
  }
  for (const [name, info] of Object.entries(ctx.rest)) {
    if (ctx.usedRest.has(name) || info.mode !== 'fixed') continue;
    routines.push({
      id: `rest_command:${name}`, name, kind: 'command', source: 'home-assistant',
      targets: toTargets([{ screenId: info.screenId, query: info.query }]), via: [],
    });
  }
  return routines;
}

const bare = (id) => (typeof id === 'string' && id.startsWith('fleet:') ? id.slice(6) : id);

function cleanParams(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (IGNORED_PARAMS.has(key) || value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

/**
 * Routines that could have sent this load, best first: same screen, and the
 * same parameter set (template values match anything). A routine whose
 * whole query is a template matches weakly.
 * @param {Array} routines
 * @param {string} deviceId - bare devices.yml key or fleet: id
 * @param {Object} params - the load's query params
 */
export function matchRoutines(routines, deviceId, params) {
  const screenId = bare(deviceId);
  const wanted = cleanParams(params);
  const scored = [];
  for (const routine of routines || []) {
    let best = 0;
    for (const target of routine.targets || []) {
      if (target.screenId !== screenId) continue;
      const tparams = parseLoadQuery(target.query);
      let score = 0;
      if (tparams === null) score = 1;
      else {
        const keys = new Set([...Object.keys(tparams), ...Object.keys(wanted)]);
        let wild = false;
        let ok = true;
        for (const key of keys) {
          if (!(key in tparams) || !(key in wanted)) { ok = false; break; }
          if (tparams[key] === '*') wild = true;
          else if (tparams[key] !== wanted[key]) { ok = false; break; }
        }
        if (ok) score = wild ? 2 : 3;
      }
      best = Math.max(best, score);
    }
    if (best > 0) scored.push({ routine, score: best + (KIND_RANK[routine.kind] ?? 0) });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.routine);
}

/** Routines with a target on this screen (stable id; bare keys accepted). */
export function routinesTargeting(routines, id) {
  const screenId = bare(id);
  return (routines || []).filter((routine) => (routine.targets || []).some((t) => t.deviceId === id || t.screenId === screenId));
}

export const ROUTINE_IMPORT_LIMITS = Object.freeze({
  maxRoutines: 500, maxId: 128, maxName: 120, maxTargets: 20, maxQuery: 1000, maxVia: 10,
});
const ROUTINE_KINDS = new Set(['automation', 'script', 'command', 'observed']);
const SCREEN_ID = /^(fleet|browser|screen):[A-Za-z0-9._-]{1,96}$/;

const boundedString = (value, max, { allowEmpty = false } = {}) => typeof value === 'string'
  && (allowEmpty || value.length > 0) && value.length <= max;

/**
 * Validate routines posted to the catalog (PUT /routines/catalog): strings
 * where strings belong, every length bounded, the count capped.
 * @param {unknown} routines
 * @returns {string[]} errors (empty = valid)
 */
export function validateRoutineImport(routines) {
  const L = ROUTINE_IMPORT_LIMITS;
  if (!Array.isArray(routines)) return ['routines must be an array'];
  if (routines.length > L.maxRoutines) return [`at most ${L.maxRoutines} routines`];
  const errors = [];
  routines.forEach((r, i) => {
    const at = `routines[${i}]`;
    if (!isObject(r)) { errors.push(`${at}: must be an object`); return; }
    if (!boundedString(r.id, L.maxId)) errors.push(`${at}.id: string of 1-${L.maxId} chars`);
    if (!boundedString(r.name, L.maxName)) errors.push(`${at}.name: string of 1-${L.maxName} chars`);
    if (r.kind !== undefined && !ROUTINE_KINDS.has(r.kind)) errors.push(`${at}.kind: one of ${[...ROUTINE_KINDS].join('|')}`);
    if (r.source !== undefined && !boundedString(r.source, L.maxId)) errors.push(`${at}.source: string of 1-${L.maxId} chars`);
    if (r.via !== undefined && (!Array.isArray(r.via) || r.via.length > L.maxVia || !r.via.every((v) => boundedString(v, L.maxId)))) {
      errors.push(`${at}.via: up to ${L.maxVia} strings of 1-${L.maxId} chars`);
    }
    if (!Array.isArray(r.targets) || r.targets.length < 1 || r.targets.length > L.maxTargets) {
      errors.push(`${at}.targets: 1-${L.maxTargets} targets`);
      return;
    }
    r.targets.forEach((t, j) => {
      if (!isObject(t) || !SCREEN_ID.test(String(t.deviceId ?? ''))) errors.push(`${at}.targets[${j}].deviceId: a screen id`);
      else if (!boundedString(t.query, L.maxQuery, { allowEmpty: true })) errors.push(`${at}.targets[${j}].query: string of at most ${L.maxQuery} chars`);
    });
  });
  return errors;
}
