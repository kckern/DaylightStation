import { DaylightAPI, DaylightMediaPath } from './api.mjs';

// App icon SVGs (Vite resolves these to hashed URLs)
import webcamIcon from '../assets/app-icons/webcam.svg';
import gratitudeIcon from '../assets/app-icons/gratitude.svg';
import wrapupIcon from '../assets/app-icons/wrapup.svg';
import officeOffIcon from '../assets/app-icons/office_off.svg';
import keycodeIcon from '../assets/app-icons/keycode.svg';
import familySelectorIcon from '../assets/app-icons/family-selector.svg';
import glympseIcon from '../assets/app-icons/glympse.svg';
import websocketIcon from '../assets/app-icons/websocket.svg';
import videocallIcon from '../assets/app-icons/videocall.svg';

export const APP_REGISTRY = {
  'webcam':          { label: 'Webcam',           icon: webcamIcon,         param: null, component: () => import('../modules/AppContainer/Apps/Webcam/Webcam.jsx') },
  'videocall':       { label: 'Video Call',       icon: videocallIcon,      param: { name: 'device' }, component: () => import('../modules/AppContainer/Apps/VideoCall/VideoCall.jsx') },
  'gratitude':       { label: 'Gratitude & Hope', icon: gratitudeIcon,      param: null, component: () => import('../modules/AppContainer/Apps/Gratitude/Gratitude.jsx') },
  'wrapup':          { label: 'Wrap Up',          icon: wrapupIcon,         param: null, component: () => import('../modules/AppContainer/Apps/WrapUp/WrapUp.jsx') },
  'office_off':      { label: 'Office Off',       icon: officeOffIcon,      param: null, component: () => import('../modules/AppContainer/Apps/OfficeOff/OfficeOff.jsx') },
  'keycode':         { label: 'Key Test',         icon: keycodeIcon,        param: null, component: () => import('../modules/AppContainer/Apps/KeyTest/KeyTest.jsx') },
  'family-selector': { label: 'Family Selector',  icon: familySelectorIcon, param: { name: 'winner', options: 'household' }, component: () => import('../modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx') },
  'glympse':         { label: 'Glympse',          icon: glympseIcon,        param: { name: 'id' }, component: () => import('../modules/AppContainer/Apps/Glympse/Glympse.jsx') },
  'websocket':       { label: 'WebSocket',        icon: websocketIcon,      param: { name: 'path' }, component: () => import('../modules/AppContainer/Apps/WebSocket/WebSocket.jsx') },
};

/**
 * Lookup an app by ID.
 * @param {string} id - App identifier (e.g., 'webcam', 'family-selector')
 * @returns {object|null} Registry entry or null if not found
 */
export function getApp(id) {
  return APP_REGISTRY[id] || null;
}

/**
 * Return all apps as an array with id attached.
 * @returns {Array<{id: string, label: string, param: object|null, component: Function}>}
 */
export function getAllApps() {
  return Object.entries(APP_REGISTRY).map(([id, entry]) => ({ id, ...entry }));
}

/**
 * Fuzzy-match against label and id, returns matching entries with id attached.
 * @param {string} query - Search string
 * @returns {Array<{id: string, label: string, param: object|null, component: Function}>}
 */
export function searchApps(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  return Object.entries(APP_REGISTRY)
    .filter(([id, entry]) =>
      id.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q)
    )
    .map(([id, entry]) => ({ id, ...entry }));
}

/**
 * Parse an app input string like "app:family-selector/felix" into structured data.
 * @param {string} input - Raw input (e.g., "app:family-selector/felix")
 * @returns {{ appId: string, paramValue: string|null, label: string, paramName: string|null, fullId: string }|null}
 */
export function resolveAppDisplay(input) {
  if (!input || !input.startsWith('app:')) return null;
  const rest = input.slice(4).trim(); // strip "app:" and whitespace
  const slashIdx = rest.indexOf('/');
  const appId = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const paramValue = slashIdx === -1 ? null : rest.slice(slashIdx + 1) || null;
  const entry = APP_REGISTRY[appId];
  if (!entry) return null;
  return {
    appId,
    paramValue,
    label: entry.label,
    paramName: entry.param?.name || null,
    fullId: input,
  };
}

const OPTION_RESOLVERS = {
  household: async () => {
    const data = await DaylightAPI('/api/v1/gratitude/bootstrap');
    return (data.users || []).map(u => ({
      value: u.id,
      label: u.group_label || u.name || u.id,
      thumbnail: DaylightMediaPath(`/static/img/users/${u.id}`),
    }));
  },
};

/**
 * Resolve param options for dropdowns or return null for free-text params.
 * @param {object|null} param - The param descriptor from a registry entry
 * @returns {Promise<Array<{value: string, label: string}>|null>}
 */
export async function resolveParamOptions(param) {
  if (!param?.options) return null;
  if (param.options.includes(',')) {
    return param.options.split(',').map(v => ({ value: v.trim(), label: v.trim() }));
  }
  const resolver = OPTION_RESOLVERS[param.options];
  return resolver ? resolver() : null;
}
