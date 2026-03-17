import { describe, it, expect } from 'vitest';
import { shouldArmStartupDeadline } from '../../../../frontend/src/modules/Player/lib/shouldArmStartupDeadline.js';

/**
 * Tests for startup deadline gating.
 *
 * The resilience hook should NOT arm a 15s startup deadline when
 * it has no media metadata — there's nothing to recover to.
 * This prevents false startup-deadline-exceeded for phantom entries.
 */

describe('shouldArmStartupDeadline', () => {
  it('returns false when meta is null', () => {
    expect(shouldArmStartupDeadline({ meta: null, disabled: false })).toBe(false);
  });

  it('returns false when meta is empty object', () => {
    expect(shouldArmStartupDeadline({ meta: {}, disabled: false })).toBe(false);
  });

  it('returns false when disabled is true', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaType: 'video', mediaUrl: '/test.mp4' },
      disabled: true
    })).toBe(false);
  });

  it('returns true when meta has mediaType', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaType: 'audio' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has mediaUrl', () => {
    expect(shouldArmStartupDeadline({
      meta: { mediaUrl: '/media/video.mp4' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has plex ID', () => {
    expect(shouldArmStartupDeadline({
      meta: { plex: '375839' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has media key', () => {
    expect(shouldArmStartupDeadline({
      meta: { media: 'sfx/intro' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has contentId', () => {
    expect(shouldArmStartupDeadline({
      meta: { contentId: 'freshvideo:teded' },
      disabled: false
    })).toBe(true);
  });

  it('returns true when meta has assetId', () => {
    expect(shouldArmStartupDeadline({
      meta: { assetId: 'files:sfx/intro' },
      disabled: false
    })).toBe(true);
  });
});
