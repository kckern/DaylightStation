import { describe, it, expect } from 'vitest';
import {
  decideWarmupRecovery,
  STARTUP_WARMUP_DEADLINE_MS,
  SEEK_STALL_WARMUP_DEADLINE_MS,
  RECENT_SEEK_WINDOW_MS,
} from './decideWarmupRecovery.js';

describe('decideWarmupRecovery', () => {
  it('mid-playback + recent seek → fast URL-refresh escalation', () => {
    const d = decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: 800 });
    expect(d.kind).toBe('seek-stall');
    expect(d.deadlineMs).toBe(SEEK_STALL_WARMUP_DEADLINE_MS);
    expect(d.reason).toBe('seek-stall-transcode-warming');
  });

  it('startup warmup (never played) rides it out at 60s, even right after the start seek', () => {
    const d = decideWarmupRecovery({ hasEverPlayed: false, msSinceLastSeek: 300 });
    expect(d.kind).toBe('startup');
    expect(d.deadlineMs).toBe(STARTUP_WARMUP_DEADLINE_MS);
    expect(d.reason).toBe('startup-deadline-exceeded-after-warmup');
  });

  it('mid-playback but NO recent seek → treated as startup-style (not seek-induced)', () => {
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: RECENT_SEEK_WINDOW_MS + 1 }).kind).toBe('startup');
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: Infinity }).kind).toBe('startup');
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: NaN }).kind).toBe('startup');
  });

  it('right at the window boundary is NOT counted (exclusive)', () => {
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: RECENT_SEEK_WINDOW_MS }).kind).toBe('startup');
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: RECENT_SEEK_WINDOW_MS - 1 }).kind).toBe('seek-stall');
  });

  it('ignores nonsensical negative deltas', () => {
    expect(decideWarmupRecovery({ hasEverPlayed: true, msSinceLastSeek: -5 }).kind).toBe('startup');
  });

  it('is safe with no args', () => {
    expect(decideWarmupRecovery().kind).toBe('startup');
  });
});
