import { describe, it, expect } from 'vitest';
import {
  splitBreaks, breakLock, draftFromServer, payloadFromDraft, validateDraft, awayTrip, activityIdFor,
} from "./daysOffModel.js";

const SERVER = {
  revision: 'r1', today: '2026-11-11',
  except: [
    { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' },
    { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day', tier: 'away' },
    { from: '2026-11-08', to: '2026-11-14', label: 'Trip', tier: 'away' },
  ],
  dayOffTiers: null,
  effectivePolicy: { 'stay-home': { keep: [{ subject: 'scripture' }] }, enrichment: { keep: [] }, 'major-holiday': { keep: [{ subject: 'scripture' }] }, away: { keep: [] } },
  activities: { 'holiday-thanksgiving': { unitId: 'holiday-thanksgiving', title: 'Thanksgiving activity', instructions: '', editable: true } },
};

describe('daysOffModel', () => {
  it('splits upcoming (by start) from past (newest first)', () => {
    const { upcoming, past } = splitBreaks(SERVER.except, '2026-11-11');
    expect(upcoming.map((b) => b.label)).toEqual(['Trip', 'Thanksgiving']);
    expect(past.map((b) => b.label)).toEqual(['Labor Day']);
  });

  it('locks past breaks and the start of a started one', () => {
    expect(breakLock({ from: '2026-09-07', to: '2026-09-07' }, '2026-11-11')).toBe('past');
    expect(breakLock({ from: '2026-11-08', to: '2026-11-14' }, '2026-11-11')).toBe('started');
    // A break starting today has had nothing judged yet: fully editable.
    expect(breakLock({ from: '2026-11-11', to: '2026-11-11' }, '2026-11-11')).toBe('open');
    expect(breakLock({ from: '2026-11-12', to: '2026-11-12' }, '2026-11-11')).toBe('open');
  });

  it('round-trips the server model, keeping past breaks verbatim and sending activity text', () => {
    const draft = draftFromServer(SERVER);
    expect(draft.baseRevision).toBe('r1');
    expect(draft.keepLists).toBeNull();
    const thanks = draft.breaks.find((b) => b.label === 'Thanksgiving');
    thanks.activity.title = 'Gratitude list';
    thanks.activity.instructions = 'Write five things.';
    const payload = payloadFromDraft(draft);
    expect(payload.baseRevision).toBe('r1');
    expect(payload.except).toContainEqual({ from: '2026-09-07', to: '2026-09-07', label: 'Labor Day', tier: 'away' });
    expect(payload.except).toContainEqual(expect.objectContaining({ label: 'Thanksgiving', assignment: 'holiday-thanksgiving' }));
    expect(payload.activities).toEqual([{ unitId: 'holiday-thanksgiving', title: 'Gratitude list', instructions: 'Write five things.' }]);
    expect(payload.dayOffTiers).toBeNull();
  });

  it('a new enrichment break gets an activity id from its label and sends replaces', () => {
    const draft = draftFromServer(SERVER);
    draft.breaks.push({ key: 'n1', from: '2026-12-07', to: '2026-12-07', label: 'Science Fair!', tier: 'enrichment', replaces: 'science', activity: { title: 'Volcano', instructions: '' }, isNew: true, assignTo: ['kid'] });
    const payload = payloadFromDraft(draft);
    expect(payload.except).toContainEqual({ from: '2026-12-07', to: '2026-12-07', label: 'Science Fair!', tier: 'enrichment', replaces: 'science', assignment: 'holiday-science-fair' });
    expect(payload.activities).toContainEqual({ unitId: 'holiday-science-fair', title: 'Volcano', instructions: '' });
    expect(payload.assignTo).toEqual(['kid']);
    expect(activityIdFor('  Christmas Eve & Day ')).toBe('holiday-christmas-eve-day');
  });

  it('a tier without an activity drops replaces and assignment', () => {
    const draft = draftFromServer(SERVER);
    const thanks = draft.breaks.find((b) => b.label === 'Thanksgiving');
    thanks.tier = 'stay-home';
    const payload = payloadFromDraft(draft);
    expect(payload.except.find((b) => b.label === 'Thanksgiving')).toEqual({ from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'stay-home' });
    expect(payload.activities).toEqual([]);
  });

  it('validates in plain words', () => {
    const base = draftFromServer(SERVER);
    const withBreak = (b) => ({ ...base, breaks: [...base.breaks, { key: 'x', label: 'X', tier: 'away', from: '2026-12-01', to: '2026-12-01', ...b }] });
    expect(validateDraft(base)).toBeNull();
    expect(validateDraft(withBreak({ label: ' ' }))).toMatch(/needs a name/);
    expect(validateDraft(withBreak({ to: '' }))).toMatch(/needs both dates/);
    expect(validateDraft(withBreak({ to: '2026-11-30' }))).toMatch(/ends before it starts/);
    expect(validateDraft(withBreak({ tier: 'enrichment', activity: { title: 'T' } }))).toMatch(/subject/);
    expect(validateDraft(withBreak({ tier: 'major-holiday', activity: { title: '' } }))).toMatch(/activity a title/);
  });

  it('awayTrip builds an away break', () => {
    expect(awayTrip({ from: '2026-12-28', to: '2026-12-31', label: '' })).toMatchObject({ from: '2026-12-28', to: '2026-12-31', label: 'Away', tier: 'away', isNew: true });
  });
});
