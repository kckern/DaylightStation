import { describe, it, expect } from '@jest/globals';
import { isProgressCommittable } from '#domains/content/services/isProgressCommittable.mjs';

describe('isProgressCommittable', () => {

  // ── Small jumps (within 5-minute / 300s threshold) ───────────────────

  describe('small jumps — always committable', () => {
    it('commits a small forward jump (e.g. 120s)', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 720,
      });
      expect(result).toEqual({ committable: true });
    });

    it('commits a small backward jump (30s rewind)', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 570,
      });
      expect(result).toEqual({ committable: true });
    });

    it('commits exactly at the 5-minute boundary (300s jump)', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 900,
      });
      expect(result).toEqual({ committable: true });
    });

    it('commits from zero with a small forward jump', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 0,
        newPlayhead: 120,
      });
      expect(result).toEqual({ committable: true });
    });
  });

  // ── Large jumps — skeptical mode ─────────────────────────────────────

  describe('large jumps — skeptical until watch time proves intent', () => {
    it('rejects a large forward jump with 0s watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 1800,
      });
      expect(result).toEqual({ committable: false, skeptical: true });
    });

    it('rejects a large forward jump with 59s watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 59,
        lastCommittedPlayhead: 600,
        newPlayhead: 1800,
      });
      expect(result).toEqual({ committable: false, skeptical: true });
    });

    it('commits a large forward jump with exactly 60s watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 60,
        lastCommittedPlayhead: 600,
        newPlayhead: 1800,
      });
      expect(result).toEqual({ committable: true });
    });

    it('commits a large forward jump with 120s watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 120,
        lastCommittedPlayhead: 600,
        newPlayhead: 1800,
      });
      expect(result).toEqual({ committable: true });
    });

    it('rejects a large backward jump with insufficient watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 10,
        lastCommittedPlayhead: 1800,
        newPlayhead: 300,
      });
      expect(result).toEqual({ committable: false, skeptical: true });
    });

    it('commits a large backward jump with sufficient watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 60,
        lastCommittedPlayhead: 1800,
        newPlayhead: 300,
      });
      expect(result).toEqual({ committable: true });
    });
  });

  // ── Boundary: just over 5-minute threshold ───────────────────────────

  describe('boundary — just over the 5-minute threshold', () => {
    it('enters skeptical mode for a 301s jump with 0s watch time', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 901,
      });
      expect(result).toEqual({ committable: false, skeptical: true });
    });

    it('commits a 301s jump once 60s of watch time is accumulated', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 60,
        lastCommittedPlayhead: 600,
        newPlayhead: 901,
      });
      expect(result).toEqual({ committable: true });
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('commits when newPlayhead equals lastCommittedPlayhead (no jump)', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 600,
      });
      expect(result).toEqual({ committable: true });
    });

    it('commits exactly backward 300s', () => {
      const result = isProgressCommittable({
        sessionWatchTime: 0,
        lastCommittedPlayhead: 600,
        newPlayhead: 300,
      });
      expect(result).toEqual({ committable: true });
    });
  });
});
