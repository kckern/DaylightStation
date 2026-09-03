const PRESENCE_EVENTS = new Set(['pressed', 'released', 'stomped']);

export function normalizePressureMatMessage(message, previous = null) {
  if (!message || message.topic !== 'pressure-mat' || typeof message.id !== 'string') return null;
  if (!['reading', 'presence', 'hello'].includes(message.type)) return null;
  if (message.type === 'presence' && !PRESENCE_EVENTS.has(message.event)) return null;

  return {
    id: message.id,
    type: message.type,
    event: message.event || null,
    protocolVersion: optionalNonnegative(message.protocolVersion, previous?.protocolVersion),
    deviceTs: optionalNonnegative(message.deviceTs, previous?.deviceTs),
    bootCount: optionalNonnegative(message.bootCount, previous?.bootCount),
    lastReset: message.lastReset || previous?.lastReset || null,
    occupied: Boolean(message.occupied),
    steps: nonnegative(message.steps, previous?.steps),
    stomps: nonnegative(message.stomps, previous?.stomps),
    voltage: finiteOr(message.voltage, previous?.voltage),
    restVoltage: finiteOr(message.restVoltage, previous?.restVoltage),
    deltaV: finiteOr(message.deltaV, previous?.deltaV),
    gradientVps: finiteOr(message.gradientVps, previous?.gradientVps),
    peakDeltaV: finiteOr(message.peakDeltaV),
    peakGradientVps: finiteOr(message.peakGradientVps),
    pressDurationMs: finiteOr(message.pressDurationMs),
    classifiedStomp: typeof message.classifiedStomp === 'boolean' ? message.classifiedStomp : null,
    receivedAt: message.receivedAt || new Date().toISOString(),
  };
}

// A stomp is a classified step, so it must not produce another step event.
export function pressureMatFitnessEvent(reading) {
  if (reading?.type !== 'presence') return null;
  if (reading.event === 'pressed') return { type: 'pressure-mat:step', payload: reading };
  if (reading.event === 'stomped') return { type: 'pressure-mat:stomp', payload: reading };
  if (reading.event === 'released') return { type: 'pressure-mat:released', payload: reading };
  return null;
}

const finiteOr = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : (fallback ?? null);
const nonnegative = (value, fallback = 0) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : (fallback ?? 0));
const optionalNonnegative = (value, fallback = null) => {
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value));
  return Number.isFinite(Number(fallback)) ? Math.max(0, Number(fallback)) : null;
};
