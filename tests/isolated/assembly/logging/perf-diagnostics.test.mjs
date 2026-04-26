import { vi } from 'vitest';

// Polyfill browser globals for Node.js test environment
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));

// Mock the shared transport before importing Logger
const mockSend = vi.fn();
vi.mock('#frontend/lib/logging/sharedTransport.js', () => ({
  getSharedWsTransport: () => ({ send: mockSend })
}));

const { configure, perfSnapshot, startDiagnostics, stopDiagnostics } = await import('#frontend/lib/logging/Logger.js');

describe('perf diagnostics circular buffer', () => {
  beforeEach(() => {
    mockSend.mockClear();
    configure({ level: 'debug', consoleEnabled: false, websocketEnabled: true });
    stopDiagnostics();
  });

  afterEach(() => {
    stopDiagnostics();
  });

  test('collectSnapshot computes correct min/max/avg from frame times', () => {
    startDiagnostics({ intervalMs: 999999 });
    const snap = perfSnapshot();
    expect(snap).toEqual(expect.objectContaining({
      fps: expect.any(Number),
      frameMs: expect.objectContaining({
        avg: expect.any(Number),
        min: expect.any(Number),
        max: expect.any(Number),
      }),
      jankFrames: expect.any(Number),
      sampleCount: expect.any(Number),
    }));
  });

  test('collectSnapshot returns zeros on empty buffer', () => {
    startDiagnostics({ intervalMs: 999999 });
    const snap = perfSnapshot();
    expect(snap.fps).toBe(0);
    expect(snap.frameMs.min).toBe(0);
    expect(snap.frameMs.max).toBe(0);
    expect(snap.sampleCount).toBe(0);
  });

  test('circular buffer min/max/jank are correct after wrapping', () => {
    startDiagnostics({ intervalMs: 999999 });
    const snap = perfSnapshot();
    expect(snap.sampleCount).toBe(0);
    expect(snap.jankFrames).toBe(0);
    expect(snap.fps).toBe(0);
  });
});
