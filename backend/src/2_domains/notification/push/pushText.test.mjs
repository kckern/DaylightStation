import { describe, it, expect } from 'vitest';
import {
  titleCaseId, personDisplayName, formatClockTime, formatDuration,
  formatStudyDay, pushData, findPushTextDefects,
} from './pushText.mjs';

describe('personDisplayName', () => {
  it('prefers display_name, then name, then a title-cased id', () => {
    expect(personDisplayName({ display_name: 'Learner4', name: 'x' }, 'user_4')).toBe('Learner4');
    expect(personDisplayName({ name: 'Learner5' }, 'user_5')).toBe('Learner5');
    expect(personDisplayName(null, 'user_6')).toBe('User 6');
    expect(personDisplayName({ display_name: '  ' }, null)).toBeNull();
  });
});

describe('titleCaseId', () => {
  it('turns ids into words', () => {
    expect(titleCaseId('livingroom-tv')).toBe('Livingroom Tv');
    expect(titleCaseId('living_room')).toBe('Living Room');
    expect(titleCaseId('')).toBeNull();
  });
});

describe('time formatting', () => {
  it('formats a UTC instant as local clock time', () => {
    expect(formatClockTime('2026-08-28T01:13:29.185Z', 'America/Los_Angeles')).toBe('6:13 PM');
    expect(formatClockTime('not a date', 'America/Los_Angeles')).toBeNull();
  });
  it('formats durations in minutes and hours', () => {
    expect(formatDuration(30 * 60_000)).toBe('30 min');
    expect(formatDuration(90 * 60_000)).toBe('1 hr 30 min');
    expect(formatDuration(120 * 60_000)).toBe('2 hr');
    expect(formatDuration(-5)).toBeNull();
  });
  it('formats a study day key as a short date', () => {
    expect(formatStudyDay('2026-09-14')).toBe('Mon Sep 14');
    expect(formatStudyDay('2026-9-14')).toBeNull();
  });
});

describe('pushData', () => {
  it('keeps only the metadata that is set, and spells alert_once the HA way', () => {
    expect(pushData({ tag: 't', group: null, channel: 'C', importance: 'low', alertOnce: true, actions: [1] }))
      .toEqual({ tag: 't', channel: 'C', importance: 'low', alert_once: true, actions: [1] });
    expect(pushData()).toEqual({});
  });
});

describe('findPushTextDefects', () => {
  it('passes finished text', () => {
    expect(findPushTextDefects('✅ Learner4 — Come Follow Me: Isaiah 13–17')).toEqual([]);
    expect(findPushTextDefects('What Are Flats in Music?')).toEqual([]);
  });
  it.each([
    ['None — None / None', 'none'],
    ['score null', 'null'],
    ['undefined%', 'undefined'],
    ['plex:675689 / lesson', 'plex-key'],
    ['cfm-w35-d2-psalms-62-69', 'slug'],
    ['until 2026-08-28T01:13:29.185Z', 'iso-timestamp'],
    ['What Are Flats in Music?.', 'double-punctuation'],
    ['Worksheet Needs_remediation', 'snake-case'],
    ['   ', 'empty'],
  ])('flags %s', (text, defect) => {
    expect(findPushTextDefects(text)).toContain(defect);
  });
});
