export const COMMAND_KINDS = Object.freeze([
  'transport', 'queue', 'config', 'adopt-snapshot', 'system',
]);

export const TRANSPORT_ACTIONS = Object.freeze([
  'play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev',
]);

export const QUEUE_OPS = Object.freeze([
  'play-now', 'play-next', 'add-up-next', 'add',
  'reorder', 'remove', 'jump', 'clear',
]);

export const CONFIG_SETTINGS = Object.freeze(['shuffle', 'repeat', 'shader', 'volume']);

export const SYSTEM_ACTIONS = Object.freeze(['reset', 'reload', 'sleep', 'wake']);

export const REPEAT_MODES = Object.freeze(['off', 'one', 'all']);

export const SESSION_STATES = Object.freeze([
  'idle', 'ready', 'loading', 'playing', 'paused',
  'buffering', 'stalled', 'ended', 'error',
]);

export const isCommandKind     = (v) => COMMAND_KINDS.includes(v);
export const isTransportAction = (v) => TRANSPORT_ACTIONS.includes(v);
export const isQueueOp         = (v) => QUEUE_OPS.includes(v);
export const isConfigSetting   = (v) => CONFIG_SETTINGS.includes(v);
export const isSystemAction    = (v) => SYSTEM_ACTIONS.includes(v);
export const isRepeatMode      = (v) => REPEAT_MODES.includes(v);
export const isSessionState    = (v) => SESSION_STATES.includes(v);
