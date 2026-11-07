import { describe, it, expect } from 'vitest';
import { cueModality, fitEffectToChannel, isWordLabel } from './cueModality.mjs';

describe('cueModality', () => {
  it('type mute is said, type skip is shown', () => {
    expect(cueModality({ type: 'mute', label: 'G*d' })).toBe('said');
    expect(cueModality({ type: 'skip', category: 'language/language_sexual/other_sexual', label: 'A billboard shows an obscene word' })).toBe('shown');
  });
  it('refine kind wins', () => {
    expect(cueModality({ type: 'skip', kind: 'speech-line' })).toBe('said');
    expect(cueModality({ type: 'mute', refine: { kind: 'visual' } })).toBe('shown');
    expect(cueModality({ type: 'mute', kind: 'sound' })).toBe('heard');
  });
  it('a sound label under mute is heard', () => {
    expect(cueModality({ type: 'mute', label: 'Gunfire can be heard' })).toBe('heard');
  });
  it('exposes the word-label helper', () => {
    expect(isWordLabel('G*d')).toBe(true);
    expect(isWordLabel('A man talks about it.')).toBe(false);
  });
});

describe('fitEffectToChannel', () => {
  it('shown + audio effect -> blur (tracked) or full-blur', () => {
    expect(fitEffectToChannel('bleep', 'shown', { hasRegions: true })).toBe('blur');
    expect(fitEffectToChannel('mute', 'shown', { hasRegions: false })).toBe('full-blur');
  });
  it('said + visual effect -> mute', () => {
    expect(fitEffectToChannel('blur', 'said', {})).toBe('mute');
    expect(fitEffectToChannel('pixelate', 'heard', {})).toBe('mute');
  });
  it('matching and skip effects pass through', () => {
    expect(fitEffectToChannel('bleep', 'said', {})).toBe('bleep');
    expect(fitEffectToChannel('skip', 'shown', {})).toBe('skip');
    expect(fitEffectToChannel('skip-card', 'said', {})).toBe('skip-card');
    expect(fitEffectToChannel('blur', 'shown', { hasRegions: false })).toBe('blur');
  });
  it('heard bleep -> mute; empty -> null', () => {
    expect(fitEffectToChannel('bleep', 'heard', {})).toBe('mute');
    expect(fitEffectToChannel(null, 'said', {})).toBeNull();
  });
});
