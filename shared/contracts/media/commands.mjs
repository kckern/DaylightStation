export const COMMAND_KINDS = Object.freeze([
  'transport', 'queue', 'config', 'adopt-snapshot', 'system', 'display', 'handoff',
  // Screen session controls (sleep timer, Put it back, next-episode countdown).
  // Params are validated by `validateSessionActionParams` in sessionControls.mjs.
  'session',
]);

export const TRANSPORT_ACTIONS = Object.freeze([
  'play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev',
]);

export const QUEUE_OPS = Object.freeze([
  'play-now', 'play-next', 'add-up-next', 'add',
  'reorder', 'remove', 'jump', 'clear',
  'item-action', 'undo',
]);

// addOnly / endOfQueue / stopAfterCurrent are screen session flags
// (RQ-PLAY-10, RQ-STEER-19, RQ-STEER-20); see sessionControls.mjs.
export const CONFIG_SETTINGS = Object.freeze([
  'shuffle', 'repeat', 'shader', 'volume', 'addOnly', 'endOfQueue', 'stopAfterCurrent',
]);

// Optional `params.intent` on a transport command. `move` marks the stop that
// takes playback away to another screen (claim / Move here), so the screen
// can say "Moved" instead of "Stopped".
export const TRANSPORT_INTENTS = Object.freeze(['move']);

// Optional `params.keepMusic` (boolean) on a `stop` transport command: the
// sender's EXPLICIT answer to "Keep the music playing?" for a slideshow with
// music behind it. true = leave the music, false = stop it too. Absent = the
// screen falls back to inferring from the command's origin (legacy senders).
export const isKeepMusicParam = (v) => typeof v === 'boolean';

export const SYSTEM_ACTIONS = Object.freeze(['reset', 'reload', 'sleep', 'wake']);

export const REPEAT_MODES = Object.freeze(['off', 'one', 'all']);

export const SESSION_STATES = Object.freeze([
  'idle', 'ready', 'loading', 'playing', 'paused',
  'buffering', 'stalled', 'ended', 'error',
]);

// Subset of QUEUE_OPS that maps to "load content into player".
// Used by WebSocketContentAdapter and WakeAndLoadService to validate
// caller-supplied `op` values before broadcast.
export const LOAD_CONTENT_QUEUE_OPS = Object.freeze([
  'play-now', 'play-next', 'add-up-next', 'add',
]);

export const isLoadContentQueueOp = (v) => LOAD_CONTENT_QUEUE_OPS.includes(v);

export const isCommandKind     = (v) => COMMAND_KINDS.includes(v);
export const isTransportAction = (v) => TRANSPORT_ACTIONS.includes(v);
export const isQueueOp         = (v) => QUEUE_OPS.includes(v);
export const isConfigSetting   = (v) => CONFIG_SETTINGS.includes(v);
export const isSystemAction    = (v) => SYSTEM_ACTIONS.includes(v);
export const isRepeatMode      = (v) => REPEAT_MODES.includes(v);
export const isSessionState    = (v) => SESSION_STATES.includes(v);
