const PRESENCE_EVENTS = new Set(['pressed', 'released', 'stomped']);

export function normalizePressureMatMessage(message, previous = null) {
  if (!message || message.topic !== 'pressure-mat' || typeof message.id !== 'string') return null;
  if (!['reading', 'presence', 'hello'].includes(message.type)) return null;
  if (message.type === 'presence' && !PRESENCE_EVENTS.has(message.event)) return null;

  return {
    id: message.id,
    type: message.type,
    event: message.event || null,
    occupied: Boolean(message.occupied),
    steps: nonnegative(message.steps, previous?.steps),
    stomps: nonnegative(message.stomps, previous?.stomps),
    voltage: finiteOr(message.voltage, previous?.voltage),
    deltaV: finiteOr(message.deltaV, previous?.deltaV),
    gradientVps: finiteOr(message.gradientVps, previous?.gradientVps),
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
