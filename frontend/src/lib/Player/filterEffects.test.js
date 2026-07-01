import { describe, it, expect, vi } from 'vitest';
import { getEffectHandler, registerEffectHandler, listEffectHandlers, EFFECT_KINDS } from './filterEffects.js';

describe('effect registry', () => {
  it('classifies built-in effects by kind', () => {
    expect(getEffectHandler('skip').kind).toBe(EFFECT_KINDS.TRANSPORT);
    expect(getEffectHandler('mute').kind).toBe(EFFECT_KINDS.AUDIO);
    expect(getEffectHandler('bleep').kind).toBe(EFFECT_KINDS.AUDIO);
    expect(getEffectHandler('duck').kind).toBe(EFFECT_KINDS.AUDIO);
    expect(getEffectHandler('blur').kind).toBe(EFFECT_KINDS.OVERLAY);
    expect(getEffectHandler('censor-bar').kind).toBe(EFFECT_KINDS.OVERLAY);
    expect(getEffectHandler('full-blur').kind).toBe(EFFECT_KINDS.OVERLAY);
    expect(getEffectHandler('title-card').kind).toBe(EFFECT_KINDS.OVERLAY);
  });

  it('returns null for an unknown effect', () => {
    expect(getEffectHandler('nope')).toBeNull();
  });

  it('supports registering a custom effect handler', () => {
    registerEffectHandler('strobe-warning', { kind: EFFECT_KINDS.OVERLAY });
    expect(getEffectHandler('strobe-warning').kind).toBe(EFFECT_KINDS.OVERLAY);
    expect(listEffectHandlers().some((h) => h.name === 'strobe-warning')).toBe(true);
  });

  it('skip: onActive seeks just past the cue out', () => {
    const transport = { seek: vi.fn() };
    getEffectHandler('skip').onActive({ transport, cue: { in: 100, out: 130 } });
    expect(transport.seek).toHaveBeenCalledWith(expect.closeTo(130.05, 2));
  });

  it('mute: onEnter/onExit toggle el.muted', () => {
    const el = { muted: false };
    getEffectHandler('mute').onEnter({ el, cue: {} });
    expect(el.muted).toBe(true);
    getEffectHandler('mute').onExit({ el, cue: {} });
    expect(el.muted).toBe(false);
  });

  it('bleep: onEnter mutes source + plays the SFX, onExit restores', () => {
    const el = { muted: false };
    const sfx = { play: vi.fn(), stop: vi.fn() };
    getEffectHandler('bleep').onEnter({ el, sfx, cue: { sound: 'car-horn' } });
    expect(el.muted).toBe(true);
    expect(sfx.play).toHaveBeenCalledWith('car-horn');
    getEffectHandler('bleep').onExit({ el, sfx, cue: {} });
    expect(el.muted).toBe(false);
    expect(sfx.stop).toHaveBeenCalled();
  });

  it('duck: onEnter lowers volume to the cue level and onExit restores', () => {
    const el = { volume: 1 };
    const mem = {};
    getEffectHandler('duck').onEnter({ el, mem, cue: { level: 0.2 } });
    expect(el.volume).toBe(0.2);
    getEffectHandler('duck').onExit({ el, mem, cue: {} });
    expect(el.volume).toBe(1);
  });
});
