import { describe, it, expect } from 'vitest';
import {
  clockTime, startStatusLine, startedByText, rowNotes, wasNameLabel, quietSummary, routineRunLine, canShowNotes,
} from './houseCopy.js';

const NOW = new Date('2026-10-03T14:10:00.000Z').getTime();
const at = (iso) => clockTime(iso, NOW);

describe('startStatusLine (RQ-HOUSE-04)', () => {
  it('reads progress while a start is under way, naming the step for the kind of screen', () => {
    expect(startStatusLine({ phase: 'starting', step: 'power', updatedAt: '2026-10-03T14:09:50.000Z' }, { kind: 'tv', now: NOW }))
      .toEqual({ tone: 'progress', text: 'Starting: Turning on TV…' });
    expect(startStatusLine({ phase: 'delivered', step: 'load', updatedAt: '2026-10-03T14:09:55.000Z' }, { kind: 'tv', now: NOW }))
      .toEqual({ tone: 'progress', text: 'Starting: Starting playback…' });
  });

  it('says a start was taken as an add, and that a start went through for a minute', () => {
    expect(startStatusLine({ phase: 'queued', updatedAt: '2026-10-03T14:09:30.000Z' }, { now: NOW }).text).toBe('Added to its queue');
    expect(startStatusLine({ phase: 'started', updatedAt: '2026-10-03T14:09:30.000Z' }, { now: NOW }))
      .toEqual({ tone: 'ok', text: 'Started' });
    expect(startStatusLine({ phase: 'started', updatedAt: '2026-10-03T14:05:00.000Z' }, { now: NOW })).toBe(null);
  });

  it('shows a failure with its step and time, to everyone, until a later start succeeds', () => {
    const failed = { phase: 'failed', step: 'power', error: 'timeout', updatedAt: '2026-10-03T14:02:00.000Z' };
    expect(startStatusLine(failed, { kind: 'tv', now: NOW }))
      .toEqual({ tone: 'failed', text: `Couldn't start at ${at('2026-10-03T14:02:00.000Z')}: Turning on TV failed (timeout)` });
    expect(startStatusLine({ phase: 'failed', step: 'playback', error: 'The screen did not confirm playback', updatedAt: '2026-10-03T14:02:00.000Z' }, { now: NOW }).text)
      .toBe(`Couldn't start at ${at('2026-10-03T14:02:00.000Z')}: The screen did not confirm playback`);
    const later = { phase: 'started', updatedAt: '2026-10-03T13:00:00.000Z', lastFailure: { step: 'load', error: 'no ack', at: '2026-10-03T12:00:00.000Z' } };
    expect(startStatusLine(later, { now: NOW }).tone).toBe('failed');
  });

  it('marks a start that went quiet', () => {
    expect(startStatusLine({ phase: 'starting', step: 'load', stale: true, updatedAt: '2026-10-03T14:00:00.000Z' }, { now: NOW }))
      .toEqual({ tone: 'failed', text: `A start stopped reporting at ${at('2026-10-03T14:00:00.000Z')}` });
    expect(startStatusLine(null, { now: NOW })).toBe(null);
  });
});

describe('startedByText (RQ-HOUSE-07)', () => {
  it('names the routine or device and the time', () => {
    expect(startedByText({ startedBy: { kind: 'routine', name: 'Kitchen Button 1: Morning Program' }, at: '2026-10-03T14:02:31.000Z' }, NOW))
      .toBe(`Started by Kitchen Button 1: Morning Program, ${at('2026-10-03T14:02:31.000Z')}`);
    expect(startedByText({ startedBy: { kind: 'device', id: 'browser:a', name: "Dad's phone" }, at: '2026-10-03T14:02:31.000Z' }, NOW))
      .toBe(`Started by Dad's phone, ${at('2026-10-03T14:02:31.000Z')}`);
  });

  it('says nothing when the origin is unknown rather than guessing', () => {
    expect(startedByText({ startedBy: null, at: null }, NOW)).toBe(null);
    expect(startedByText(null, NOW)).toBe(null);
  });
});

describe('rowNotes (RQ-STEER-21)', () => {
  it('groups repeats and offers Put it back only while it is available', () => {
    const notes = rowNotes({
      notes: [
        { id: 'n1', kind: 'paused', label: "Paused by Dad's phone", count: 3, at: '2026-10-03T14:09:58.000Z', putBack: { availableUntil: '2026-10-03T14:10:05.000Z' } },
        { id: 'n0', kind: 'stopped', label: 'Stopped by Kitchen tablet', count: 1, at: '2026-10-03T13:00:00.000Z', putBack: null },
      ],
    }, NOW);
    expect(notes).toEqual([
      { id: 'n1', text: `Paused by Dad's phone ×3 · ${at('2026-10-03T14:09:58.000Z')}`, putBack: true },
      { id: 'n0', text: `Stopped by Kitchen tablet · ${at('2026-10-03T13:00:00.000Z')}`, putBack: false },
    ]);
    expect(rowNotes(null, NOW)).toEqual([]);
  });

  it('knows which screens cannot show their own notes', () => {
    expect(canShowNotes({ type: 'speaker' })).toBe(false);
    expect(canShowNotes({ type: 'speaker-lane' })).toBe(false);
    expect(canShowNotes({ type: 'shield-tv', content_control: {} })).toBe(true);
    expect(canShowNotes({ type: 'browser' })).toBe(true);
  });
});

describe('wasNameLabel (RQ-HOUSE-06)', () => {
  it('shows the previous name only when it differs', () => {
    expect(wasNameLabel({ name: 'Poo', wasName: 'Kitchen tablet' })).toBe('(was Kitchen tablet)');
    expect(wasNameLabel({ name: 'Poo', wasName: 'Poo' })).toBe(null);
    expect(wasNameLabel({ name: 'Poo' })).toBe(null);
    expect(wasNameLabel({ name: 'Poo', wasName: 'Browser aaaa1111' })).toBe(null);
  });
});

describe('quietSummary (RQ-STEER-13)', () => {
  it('counts what happened and lists every screen that was not reached', () => {
    expect(quietSummary('pause', { done: ['Den TV', 'This device'], missed: [] }))
      .toEqual({ primary: 'Paused 2 screens', secondary: 'Den TV, This device' });
    expect(quietSummary('stop', { done: ['Den TV'], missed: [{ name: 'Office', reason: 'not reachable' }] }))
      .toEqual({ primary: 'Stopped 1 screen', secondary: 'Not stopped: Office (not reachable)' });
    expect(quietSummary('resume', { done: [], missed: [] }))
      .toEqual({ primary: 'Nothing to resume', secondary: null });
  });
});

describe('routineRunLine (RQ-AUTO-05)', () => {
  it('reads when, where, what and how it went in plain words', () => {
    expect(routineRunLine({
      at: '2026-10-03T14:02:00.000Z', routine: { name: 'Kitchen Button 4: Slow TV' }, screenName: 'Living Room TV',
      what: { key: 'queue', value: 'slow-tv' }, outcome: 'failed', reason: 'Living Room TV did not turn on',
    }, NOW)).toEqual({
      when: at('2026-10-03T14:02:00.000Z'), routine: 'Kitchen Button 4: Slow TV', screen: 'Living Room TV',
      what: 'slow-tv', outcome: 'Failed', tone: 'failed', reason: 'Living Room TV did not turn on',
    });
    expect(routineRunLine({ at: '2026-10-03T14:02:00.000Z', routine: { name: 'R' }, screenName: 'Den',
      what: { key: 'play', value: 'plex:1' }, outcome: 'started', played: { title: 'Bluey' } }, NOW))
      .toMatchObject({ what: 'Bluey', outcome: 'Played', tone: 'ok', reason: null });
    expect(routineRunLine({ at: '2026-10-03T14:02:00.000Z', routine: { name: 'R' }, screenName: 'Den',
      what: null, outcome: 'started', played: null }, NOW))
      .toMatchObject({ outcome: 'Started, not seen playing', tone: 'warn' });
  });
});
