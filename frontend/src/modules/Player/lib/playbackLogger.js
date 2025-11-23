const PLAYER_DEBUG_MODE_DEFAULT = true;

let playerDebugMode = PLAYER_DEBUG_MODE_DEFAULT;

const coerceBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === 'off') {
      return false;
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return true;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return Boolean(value);
};

const readWindowDebugFlag = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  if (typeof window.PLAYER_DEBUG_MODE === 'undefined') {
    return null;
  }
  return coerceBoolean(window.PLAYER_DEBUG_MODE);
};

const initialWindowFlag = readWindowDebugFlag();
if (typeof initialWindowFlag === 'boolean') {
  playerDebugMode = initialWindowFlag;
}

export const PLAYER_DEBUG_MODE = PLAYER_DEBUG_MODE_DEFAULT;

export const getPlayerDebugMode = () => playerDebugMode;

export const isPlayerDebugModeEnabled = () => getPlayerDebugMode();

export const setPlayerDebugMode = (value) => {
  playerDebugMode = coerceBoolean(value);
  if (typeof window !== 'undefined') {
    window.PLAYER_DEBUG_MODE = playerDebugMode;
  }
  return playerDebugMode;
};

const serializePayload = (payload) => {
  if (payload instanceof Error) {
    return {
      message: payload.message,
      stack: payload.stack
    };
  }
  return payload;
};

const stringifyValue = (value) => {
  if (value == null) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((entry, index) => `${index}:${stringifyValue(entry)}`).join(',');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key}=${stringifyValue(entry)}`)
      .join(' ');
  }
  return String(value);
};

const formatPayload = (payload) => {
  if (typeof payload === 'undefined') {
    return '';
  }
  return stringifyValue(payload);
};

export function playbackLog(event, payload, extra) {
  if (!isPlayerDebugModeEnabled()) {
    return;
  }
  const label = `[PlaybackLogger/${event}]`;
  const normalizedPayload = serializePayload(payload);
  const normalizedExtra = typeof extra === 'undefined' ? undefined : serializePayload(extra);
  const parts = [label];
  const primary = formatPayload(normalizedPayload);
  if (primary) {
    parts.push(primary);
  }
  if (typeof normalizedExtra !== 'undefined') {
    const secondary = formatPayload(normalizedExtra);
    if (secondary) {
      parts.push(secondary);
    }
  }
  console.log(parts.join(' '));
}

export default playbackLog;
