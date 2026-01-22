import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { JumpropeSessionState } from '@frontend/hooks/fitness/JumpropeSessionState.js';

describe('JumpropeSessionState', () => {
  let state;

  beforeEach(() => {
    state = new JumpropeSessionState('test-device');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('baseline tracking', () => {
    it('establishes baseline on first packet', () => {
      const result = state.ingest(100, Date.now());
      expect(result.sessionJumps).toBe(0);
    });

    it('calculates session jumps relative to baseline', () => {
      state.ingest(100, Date.now());
      const result = state.ingest(150, Date.now() + 1000);
      expect(result.sessionJumps).toBe(50);
    });
  });

  describe('RPM derivation', () => {
    it('returns 0 with insufficient data', () => {
      const result = state.ingest(100, Date.now());
      expect(result.rpm).toBe(0);
    });

    it('calculates RPM from 10-second rolling window', () => {
      const baseTime = Date.now();

      state.ingest(0, baseTime);
      jest.advanceTimersByTime(10000);
      const result = state.ingest(100, baseTime + 10000);

      expect(result.rpm).toBe(600);
    });

    it('ignores old samples outside window', () => {
      const baseTime = Date.now();

      state.ingest(0, baseTime);
      state.ingest(50, baseTime + 5000);

      jest.advanceTimersByTime(15000);
      const result = state.ingest(150, baseTime + 15000);

      expect(result.rpm).toBeGreaterThan(0);
    });

    it('returns 0 when stale (no recent data)', () => {
      const baseTime = Date.now();
      state.ingest(0, baseTime);
      state.ingest(50, baseTime + 5000);

      jest.advanceTimersByTime(20000);
      const rpm = state.deriveRPM();
      expect(rpm).toBe(0);
    });

    it('zeros RPM if no packet in last 3 seconds', () => {
      const baseTime = Date.now();

      state.ingest(0, baseTime);
      state.ingest(30, baseTime + 1000);

      jest.advanceTimersByTime(4000);
      const rpm = state.deriveRPM();
      expect(rpm).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      state.ingest(100, Date.now());
      state.ingest(150, Date.now() + 1000);

      state.reset();

      const result = state.ingest(200, Date.now() + 2000);
      expect(result.sessionJumps).toBe(0);
    });
  });
});
