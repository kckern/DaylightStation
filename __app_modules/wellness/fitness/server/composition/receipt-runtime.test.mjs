import { describe, it, expect, vi } from 'vitest';
import { createFitnessReceiptRuntime } from './receipt-runtime.mjs';

// The print and preview endpoints call `createFitnessReceiptCanvas(sessionId)`.
// Until 2026-11-23 the runtime handed them the bare renderer, which expects a
// presentation model, so every fitness receipt threw before drawing anything.
const SESSION = {
  session: { id: 's1', start: '2026-11-01 12:00:00', end: '2026-11-01 12:00:15', duration_seconds: 15 },
  timezone: 'America/Los_Angeles',
  participants: { rider: { display_name: 'Rider' } },
  timeline: {
    interval_seconds: 5,
    tick_count: 3,
    series: { 'rider:hr': [100, 120, 140], 'rider:zone': ['c', 'a', 'w'] },
  },
};

async function runtime() {
  const getSession = vi.fn(async (id) => (id === 's1' ? { toJSON: () => SESSION } : null));
  const warn = vi.fn();
  const { createFitnessReceiptCanvas } = await createFitnessReceiptRuntime({
    fitnessServices: { sessionService: { getSession } },
    householdId: 'house',
    userService: { resolveDisplayName: (slug) => slug },
    configService: { getPath: () => null },
    mediaBasePath: '/nonexistent',
    rootLogger: { warn },
  });
  return { createFitnessReceiptCanvas, getSession, warn };
}

describe('fitness receipt runtime', () => {
  it('renders a receipt from a session id', async () => {
    const { createFitnessReceiptCanvas, getSession, warn } = await runtime();
    const result = await createFitnessReceiptCanvas('s1');

    expect(warn).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledWith('s1', 'house', { decodeTimeline: false });
    expect(result.width).toBe(580);
    expect(result.height).toBeGreaterThan(0);
    expect(result.canvas.toBuffer('image/png').length).toBeGreaterThan(0);
  });

  it('returns null for a session that does not exist', async () => {
    const { createFitnessReceiptCanvas } = await runtime();
    await expect(createFitnessReceiptCanvas('missing')).resolves.toBeNull();
  });
});
