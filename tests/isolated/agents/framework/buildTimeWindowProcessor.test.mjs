// tests/isolated/agents/framework/buildTimeWindowProcessor.test.mjs
import { describe, it, expect } from 'vitest';
import { buildTimeWindowProcessor } from '../../../../backend/src/3_applications/agents/framework/buildTimeWindowProcessor.mjs';

const NOW = 1700000000000;

const oldMsg = (mins, content = `m-${mins}m`) => ({
  role: 'user',
  content,
  createdAt: new Date(NOW - mins * 60 * 1000).toISOString(),
});

// Helper to invoke whichever method name the processor uses.
// Mastra's modern interface uses processInput; older used process.
function runProc(proc, messages) {
  const arg = { messages };
  if (typeof proc.processInput === 'function') return proc.processInput(arg);
  if (typeof proc.process === 'function') return proc.process(arg);
  throw new Error('processor has no recognized method');
}

describe('buildTimeWindowProcessor', () => {
  it('returns null when config null/undefined', () => {
    expect(buildTimeWindowProcessor(null)).toBe(null);
    expect(buildTimeWindowProcessor(undefined)).toBe(null);
  });

  it('returns null when time_window_hours is null/0/missing', () => {
    expect(buildTimeWindowProcessor({ time_window_hours: null })).toBe(null);
    expect(buildTimeWindowProcessor({ time_window_hours: 0 })).toBe(null);
    expect(buildTimeWindowProcessor({})).toBe(null);
  });

  it('builds a processor that filters messages older than the window', async () => {
    const proc = buildTimeWindowProcessor(
      { time_window_hours: 1 },
      { now: () => NOW },
    );
    expect(proc).toBeDefined();
    const messages = [
      oldMsg(120),  // 2h ago — drop
      oldMsg(90),   // 1.5h ago — drop
      oldMsg(45),   // 45m ago — keep
      oldMsg(10),   // 10m ago — keep
    ];
    const filtered = await runProc(proc, messages);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].content).toBe('m-45m');
    expect(filtered[1].content).toBe('m-10m');
  });

  it('keeps all messages when none have createdAt (no info → no drop)', async () => {
    const proc = buildTimeWindowProcessor(
      { time_window_hours: 1 },
      { now: () => NOW },
    );
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const filtered = await runProc(proc, messages);
    expect(filtered).toHaveLength(2);
  });

  it('handles malformed timestamps gracefully', async () => {
    const proc = buildTimeWindowProcessor(
      { time_window_hours: 1 },
      { now: () => NOW },
    );
    const messages = [
      { role: 'user', content: 'a', createdAt: 'not-a-date' },
      oldMsg(10),
    ];
    const filtered = await runProc(proc, messages);
    // malformed timestamp → kept (no info)
    expect(filtered).toHaveLength(2);
  });

  it('processor has id and name fields', () => {
    const proc = buildTimeWindowProcessor({ time_window_hours: 1 });
    expect(proc.id).toBeDefined();
    expect(typeof proc.id).toBe('string');
    expect(proc.name).toBeDefined();
    expect(typeof proc.name).toBe('string');
  });
});
