import { describe, it, expect } from 'vitest';
import {
  resolveTabPolicies,
  tabsCarryingPolicy,
  tabOwnsCourse,
  resolveEffectivePolicy,
} from './courseTabPolicy.js';

// Mirrors the live piano.yml shape (data/household/piano/config.yml videos.collections).
const VIDEOS = {
  collections: [
    { label: 'Piano Lessons', plex: ['plex:675686'], shows: ['plex:243200'], exclude_shows: ['plex:683465'] },
    { label: 'Voice Lessons', shows: ['plex:694718', 'plex:683465'], engagement_gate: false },
    { label: 'Music Appreciation', plex: ['plex:675687'], exclude_shows: ['plex:243200'], allow_speed: true },
  ],
};

describe('resolveTabPolicies', () => {
  it('reads allow_speed and engagement_gate off each tab, defaulting conservatively', () => {
    const tabs = resolveTabPolicies(VIDEOS);
    expect(tabs.map((t) => [t.label, t.allowSpeed, t.engagementGate])).toEqual([
      ['Piano Lessons', false, true],
      ['Voice Lessons', false, false],
      ['Music Appreciation', true, true],
    ]);
  });

  it('returns [] for the legacy flat config with no collections array', () => {
    expect(resolveTabPolicies({ plexCollection: 'plex:1' })).toEqual([]);
  });
});

describe('tabsCarryingPolicy', () => {
  it('keeps only tabs that deviate from the house default', () => {
    const kept = tabsCarryingPolicy(resolveTabPolicies(VIDEOS)).map((t) => t.label);
    expect(kept).toEqual(['Voice Lessons', 'Music Appreciation']);
  });
});

describe('tabOwnsCourse', () => {
  const [piano, voice, appreciation] = resolveTabPolicies(VIDEOS);

  it('matches a cherry-picked show with no network lookup', () => {
    expect(tabOwnsCourse(voice, 'plex:694718')).toBe(true);
    expect(tabOwnsCourse(voice, '694718')).toBe(true); // bare ratingKey
  });

  it('honours exclude_shows over collection membership', () => {
    expect(tabOwnsCourse(appreciation, 'plex:243200', { 'plex:675687': ['243200'] })).toBe(false);
    expect(tabOwnsCourse(piano, 'plex:683465')).toBe(false);
  });

  it('resolves collection membership from supplied item ids', () => {
    expect(tabOwnsCourse(appreciation, 'plex:675999', { 'plex:675687': ['675999', '676000'] })).toBe(true);
    expect(tabOwnsCourse(appreciation, 'plex:999999', { 'plex:675687': ['675999'] })).toBe(false);
  });

  it('returns null — not false — while a needed collection is unresolved', () => {
    expect(tabOwnsCourse(appreciation, 'plex:675999', {})).toBeNull();
  });
});

describe('resolveEffectivePolicy', () => {
  const tabs = resolveTabPolicies(VIDEOS);
  const adult = { engagementGate: true, autoAdvance: false, allowSpeed: true };
  const kid = { engagementGate: true, autoAdvance: false, allowSpeed: false };
  const items = { 'plex:675687': ['675999'], 'plex:675686': ['675686'] };

  it('grants speed only when BOTH the user and the tab permit it', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:675999', items).allowSpeed).toBe(true);
  });

  it('denies speed to a kid even on the appreciation tab', () => {
    expect(resolveEffectivePolicy(kid, tabs, 'plex:675999', items).allowSpeed).toBe(false);
  });

  it('denies speed to an adult on a lesson tab', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:694718', items).allowSpeed).toBe(false);
  });

  it('denies speed while membership is still unresolved (fail closed)', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:675999', {}).allowSpeed).toBe(false);
  });

  it('lets a tab switch the engagement gate off for singing', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:694718', items).engagementGate).toBe(false);
  });

  it('keeps the gate on for a lesson tab', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:243200', items).engagementGate).toBe(true);
  });

  it('lets the user policy switch the gate off regardless of tab', () => {
    const relaxed = { ...adult, engagementGate: false };
    expect(resolveEffectivePolicy(relaxed, tabs, 'plex:243200', items).engagementGate).toBe(false);
  });

  it('reports the owning tab label for telemetry', () => {
    expect(resolveEffectivePolicy(adult, tabs, 'plex:694718', items).tabLabel).toBe('Voice Lessons');
  });
});
