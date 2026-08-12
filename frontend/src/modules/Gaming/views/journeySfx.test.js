import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_SOUND_IDS, CampaignSoundController } from './journeySfx.js';

function installAudioContext() {
  const start = vi.fn();
  const oscillator = {
    type: 'triangle',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
    start,
    stop: vi.fn(),
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  };
  globalThis.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; }
    createOscillator() { return oscillator; }
    createGain() { return gain; }
  };
  return { start };
}

afterEach(() => {
  delete globalThis.AudioContext;
  localStorage.clear();
});

describe('CampaignSoundController', () => {
  it('publishes the complete stable semantic cue catalog', () => {
    expect(CAMPAIGN_SOUND_IDS).toHaveLength(23);
    expect(new Set(CAMPAIGN_SOUND_IDS).size).toBe(CAMPAIGN_SOUND_IDS.length);
    expect(CAMPAIGN_SOUND_IDS).toContain('gym.badge');
    expect(CAMPAIGN_SOUND_IDS).toContain('system.error');
  });

  it('plays a once-key at most once', () => {
    const { start } = installAudioContext();
    const sound = new CampaignSoundController();
    expect(sound.play('ui.select', { onceKey: 'surface:1' })).toBe(true);
    expect(sound.play('ui.select', { onceKey: 'surface:1' })).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('suppresses cues while grading and when muted', () => {
    const { start } = installAudioContext();
    const sound = new CampaignSoundController();
    expect(sound.play('move.commit', { grading: true })).toBe(false);
    sound.setMuted(true);
    expect(sound.play('move.commit')).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
