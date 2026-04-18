import {
  isCommandKind,
  isTransportAction,
  isQueueOp,
  isConfigSetting,
  isSystemAction,
  isRepeatMode,
} from './commands.mjs';
import { validateSessionSnapshot, validatePlayableItem } from './shapes.mjs';

const DEVICE_STATE_REASONS = Object.freeze(['change', 'heartbeat', 'initial', 'offline']);
const PLAYBACK_BROADCAST_STATES = Object.freeze([
  'playing', 'paused', 'buffering', 'stalled', 'stopped', 'idle',
]);

const isStr  = (v) => typeof v === 'string' && v.length > 0;
const isNum  = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';
const isIntInRange = (v, lo, hi) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function result(errors) {
  return { valid: errors.length === 0, errors };
}

function nowIso() {
  return new Date().toISOString();
}

// --- Command envelope ------------------------------------------------------

/**
 * Build a structured command envelope (§6.2).
 * Throws TypeError if `command` is not a recognized kind.
 */
export function buildCommandEnvelope({
  targetDevice,
  targetScreen,
  command,
  params,
  commandId,
  ts,
} = {}) {
  if (!isCommandKind(command)) {
    throw new TypeError(
      `buildCommandEnvelope: unknown command kind "${String(command)}"`,
    );
  }
  const env = {
    type: 'command',
    targetDevice,
    command,
    params: params ?? {},
    commandId,
    ts: ts ?? nowIso(),
  };
  if (targetScreen !== undefined) env.targetScreen = targetScreen;
  return env;
}

/**
 * Validate per-kind params for a command envelope.
 * Returns `{ valid, errors }`.
 */
function validateCommandParams(command, params, errors) {
  const p = params ?? {};

  if (command === 'transport') {
    if (!isTransportAction(p.action)) {
      errors.push('params.action: required transport action');
      return;
    }
    if ((p.action === 'seekAbs' || p.action === 'seekRel') && !isNum(p.value)) {
      errors.push(`params.value: required finite number for action "${p.action}"`);
    }
    return;
  }

  if (command === 'queue') {
    if (!isQueueOp(p.op)) {
      errors.push('params.op: required queue op');
      return;
    }
    switch (p.op) {
      case 'play-now':
      case 'play-next':
      case 'add-up-next':
      case 'add':
        if (!isStr(p.contentId)) {
          errors.push(`params.contentId: required non-empty string for op "${p.op}"`);
        }
        break;
      case 'remove':
      case 'jump':
        if (!isStr(p.queueItemId)) {
          errors.push(`params.queueItemId: required non-empty string for op "${p.op}"`);
        }
        break;
      case 'reorder': {
        const hasFromTo = isStr(p.from) && isStr(p.to);
        const hasItems = Array.isArray(p.items) && p.items.length > 0
          && p.items.every((x) => isStr(x));
        if (!hasFromTo && !hasItems) {
          errors.push(
            'params: reorder requires either (from + to non-empty strings) '
            + 'or a non-empty items array of strings',
          );
        }
        break;
      }
      case 'clear':
        // No additional params required.
        break;
      default:
        // Unreachable thanks to isQueueOp check above.
        errors.push(`params.op: unhandled op "${String(p.op)}"`);
    }
    return;
  }

  if (command === 'config') {
    if (!isConfigSetting(p.setting)) {
      errors.push('params.setting: required config setting');
      return;
    }
    switch (p.setting) {
      case 'shuffle':
        if (!isBool(p.value)) errors.push('params.value: shuffle requires boolean');
        break;
      case 'repeat':
        if (!isRepeatMode(p.value)) errors.push('params.value: repeat requires enum (off|one|all)');
        break;
      case 'shader':
        if (p.value !== null && !isStr(p.value)) {
          errors.push('params.value: shader requires string or null');
        }
        break;
      case 'volume':
        if (!isIntInRange(p.value, 0, 100)) {
          errors.push('params.value: volume requires integer 0..100');
        }
        break;
      default:
        errors.push(`params.setting: unhandled setting "${String(p.setting)}"`);
    }
    return;
  }

  if (command === 'adopt-snapshot') {
    if (!p.snapshot || typeof p.snapshot !== 'object') {
      errors.push('params.snapshot: required object');
    } else {
      const r = validateSessionSnapshot(p.snapshot);
      if (!r.valid) {
        errors.push(`params.snapshot: ${r.errors.join('; ')}`);
      }
    }
    if (p.autoplay !== undefined && !isBool(p.autoplay)) {
      errors.push('params.autoplay: optional boolean');
    }
    return;
  }

  if (command === 'system') {
    if (!isSystemAction(p.action)) {
      errors.push('params.action: required system action');
    }
    return;
  }

  // Shouldn't reach here because kind-check is done by caller.
  errors.push(`command: unknown kind "${String(command)}"`);
}

export function validateCommandEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== 'object') {
    return result(['CommandEnvelope: not an object']);
  }
  if (!isStr(env.commandId)) errors.push('commandId: required string');
  if (env.command === undefined || env.command === null) {
    errors.push('command: required');
  } else if (!isCommandKind(env.command)) {
    errors.push(`command: unknown kind "${String(env.command)}"`);
  } else {
    validateCommandParams(env.command, env.params, errors);
  }
  if (env.targetDevice !== undefined && !isStr(env.targetDevice)) {
    errors.push('targetDevice: must be string when present');
  }
  if (env.targetScreen !== undefined && !isStr(env.targetScreen)) {
    errors.push('targetScreen: must be string when present');
  }
  if (env.ts !== undefined && !isStr(env.ts)) {
    errors.push('ts: must be ISO string when present');
  }
  return result(errors);
}

// --- Command ack -----------------------------------------------------------

/**
 * Build a CommandAck (§6.3, §9.8).
 */
export function buildCommandAck({
  deviceId,
  commandId,
  ok,
  error,
  code,
  appliedAt,
} = {}) {
  const ack = {
    topic: 'device-ack',
    deviceId,
    commandId,
    ok,
    appliedAt: appliedAt ?? nowIso(),
  };
  if (error !== undefined) ack.error = error;
  if (code !== undefined) ack.code = code;
  return ack;
}

export function validateCommandAck(ack) {
  const errors = [];
  if (!ack || typeof ack !== 'object') {
    return result(['CommandAck: not an object']);
  }
  if (ack.topic !== undefined && ack.topic !== 'device-ack') {
    errors.push('topic: must be "device-ack" when present');
  }
  if (!isStr(ack.deviceId))  errors.push('deviceId: required string');
  if (!isStr(ack.commandId)) errors.push('commandId: required string');
  if (ack.ok === undefined || ack.ok === null) {
    errors.push('ok: required boolean');
  } else if (!isBool(ack.ok)) {
    errors.push('ok: must be boolean');
  }
  if (ack.error !== undefined && typeof ack.error !== 'string') {
    errors.push('error: must be string when present');
  }
  if (ack.code !== undefined && typeof ack.code !== 'string') {
    errors.push('code: must be string when present');
  }
  if (ack.appliedAt !== undefined && !isStr(ack.appliedAt)) {
    errors.push('appliedAt: must be ISO string when present');
  }
  return result(errors);
}

// --- Device state broadcast ------------------------------------------------

/**
 * Build a DeviceStateBroadcast (§6.4, §9.7).
 */
export function buildDeviceStateBroadcast({
  deviceId,
  snapshot,
  reason,
  ts,
} = {}) {
  return {
    topic: 'device-state',
    deviceId,
    snapshot,
    reason,
    ts: ts ?? nowIso(),
  };
}

export function validateDeviceStateBroadcast(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') {
    return result(['DeviceStateBroadcast: not an object']);
  }
  if (msg.topic !== undefined && msg.topic !== 'device-state') {
    errors.push('topic: must be "device-state" when present');
  }
  if (!isStr(msg.deviceId)) errors.push('deviceId: required string');
  if (!DEVICE_STATE_REASONS.includes(msg.reason)) {
    errors.push(
      `reason: must be one of ${DEVICE_STATE_REASONS.join('|')}`,
    );
  }
  if (!msg.snapshot || typeof msg.snapshot !== 'object') {
    errors.push('snapshot: required object');
  } else {
    const r = validateSessionSnapshot(msg.snapshot);
    if (!r.valid) errors.push(`snapshot: ${r.errors.join('; ')}`);
  }
  if (msg.ts !== undefined && !isStr(msg.ts)) {
    errors.push('ts: must be ISO string when present');
  }
  return result(errors);
}

// --- Playback state broadcast ----------------------------------------------

/**
 * Build a PlaybackStateBroadcast (§9.10). Throws TypeError if state is not
 * one of the canonical broadcast states.
 */
export function buildPlaybackStateBroadcast({
  clientId,
  sessionId,
  displayName,
  state,
  currentItem,
  position,
  duration,
  config,
  ts,
} = {}) {
  if (!PLAYBACK_BROADCAST_STATES.includes(state)) {
    throw new TypeError(
      `buildPlaybackStateBroadcast: invalid state "${String(state)}"; `
      + `must be one of ${PLAYBACK_BROADCAST_STATES.join('|')}`,
    );
  }
  return {
    topic: 'playback_state',
    clientId,
    sessionId,
    displayName,
    state,
    currentItem: currentItem ?? null,
    position,
    duration,
    config,
    ts: ts ?? nowIso(),
  };
}

export function validatePlaybackStateBroadcast(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') {
    return result(['PlaybackStateBroadcast: not an object']);
  }
  if (msg.topic !== undefined && msg.topic !== 'playback_state') {
    errors.push('topic: must be "playback_state" when present');
  }
  if (!isStr(msg.clientId))    errors.push('clientId: required string');
  if (!isStr(msg.sessionId))   errors.push('sessionId: required string');
  if (!isStr(msg.displayName)) errors.push('displayName: required string');
  if (!PLAYBACK_BROADCAST_STATES.includes(msg.state)) {
    errors.push(
      `state: must be one of ${PLAYBACK_BROADCAST_STATES.join('|')}`,
    );
  }
  if (msg.currentItem !== null && msg.currentItem !== undefined) {
    const r = validatePlayableItem(msg.currentItem);
    if (!r.valid) errors.push(`currentItem: ${r.errors.join('; ')}`);
  }
  if (!isNum(msg.position)) errors.push('position: required number');
  if (!isNum(msg.duration)) errors.push('duration: required number');
  if (!msg.config || typeof msg.config !== 'object') {
    errors.push('config: required object');
  }
  if (msg.ts !== undefined && !isStr(msg.ts)) {
    errors.push('ts: must be ISO string when present');
  }
  return result(errors);
}
