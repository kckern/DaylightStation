// frontend/src/screen-framework/input/actionMap.js

const ACTION_MAP = {
  menu:     (params) => ({ action: 'menu:open', payload: { menuId: params } }),
  play:     (params) => ({ action: 'media:play', payload: { contentId: params } }),
  queue:    (params) => ({ action: 'media:queue', payload: { contentId: params } }),
  playback: (params) => ({ action: 'media:playback', payload: { command: params } }),
  escape:   ()       => ({ action: 'escape', payload: {} }),
  volume:   (params) => ({ action: 'display:volume', payload: { command: params } }),
  shader:   ()       => ({ action: 'display:shader', payload: {} }),
  sleep:    ()       => ({ action: 'display:sleep', payload: {} }),
  rate:     ()       => ({ action: 'media:rate', payload: {} }),
};

export function translateAction(functionName, params) {
  const translator = ACTION_MAP[functionName];
  if (!translator) return null;
  return translator(params);
}

export function translateSecondary(secondary) {
  if (!secondary || typeof secondary !== 'string') return null;
  const colonIndex = secondary.indexOf(':');
  if (colonIndex === -1) return null;
  const fn = secondary.substring(0, colonIndex).trim().toLowerCase();
  const params = secondary.substring(colonIndex + 1).trim();
  return translateAction(fn, params);
}

export { ACTION_MAP };
