import { describe, it, expect } from 'vitest';
import { createThrashDetector } from './layoutMonitor.js';

describe('createThrashDetector', () => {
  it('trips when >= threshold events fall within the window', () => {
    const d = createThrashDetector({ windowMs: 1000, threshold: 4 });
    d.record(0); d.record(100); d.record(200);
    expect(d.tripped(300)).toBe(false); // only 3 in window
    d.record(300);
    expect(d.tripped(300)).toBe(true);  // 4 within 1000ms
  });
  it('forgets events older than the window', () => {
    const d = createThrashDetector({ windowMs: 1000, threshold: 3 });
    d.record(0); d.record(100);
    d.record(2000); // 0 and 100 are now stale (>1000ms before 2000)
    expect(d.count(2000)).toBe(1);
    expect(d.tripped(2000)).toBe(false);
  });
  it('reports a count for the current window', () => {
    const d = createThrashDetector({ windowMs: 500, threshold: 99 });
    d.record(0); d.record(400); d.record(450);
    expect(d.count(450)).toBe(3);
    expect(d.count(1000)).toBe(0);
  });
});
