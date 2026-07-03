import { describe, it, expect } from 'vitest';
import { dramaEventToasts } from './dramaEventCopy.js';

const riders = { a: { displayName: 'Ada' }, b: { displayName: 'Ben' }, c: { displayName: 'Cy' } };

describe('dramaEventToasts', () => {
  it('LEAD_CHANGE announces the new leader by name', () => {
    const toasts = dramaEventToasts({ type: 'LEAD_CHANGE', riderIds: ['b'] }, {}, riders);
    expect(toasts).toEqual([{ variant: 'lead-change', title: 'Ben takes the lead!' }]);
  });

  it('LEAD_CHANGE with no leaderId (e.g. a solo field edge case) emits nothing', () => {
    expect(dramaEventToasts({ type: 'LEAD_CHANGE', riderIds: [] }, {}, riders)).toEqual([]);
  });

  it('RIDER_FINISHED — the first finisher of the race gets the "crosses the line first" subtitle', () => {
    const snapshot = { ridersView: { a: { finishTimeS: 42 }, b: { finishTimeS: null }, c: { finishTimeS: null } } };
    const toasts = dramaEventToasts({ type: 'RIDER_FINISHED', riderIds: ['a'] }, snapshot, riders);
    expect(toasts).toEqual([{ variant: 'finished', title: 'Ada finishes 1st!', subtitle: 'Crosses the line first' }]);
  });

  it('RIDER_FINISHED — a later finisher gets the correct ordinal and no "first" subtitle', () => {
    // a already finished earlier; b finishes now — 2nd place.
    const snapshot = { ridersView: { a: { finishTimeS: 30 }, b: { finishTimeS: 55 }, c: { finishTimeS: null } } };
    const toasts = dramaEventToasts({ type: 'RIDER_FINISHED', riderIds: ['b'] }, snapshot, riders);
    expect(toasts).toEqual([{ variant: 'finished', title: 'Ben finishes 2nd!', subtitle: undefined }]);
  });

  it('RIDER_FINISHED — a tie in the same tick is ordered by actual finish time, not riderIds order', () => {
    // riderIds arrives as [b, a] but a's finishTimeS (10.1) is earlier than b's (10.4) —
    // a must be placed 1st despite coming second in the events array.
    const snapshot = { ridersView: { a: { finishTimeS: 10.1 }, b: { finishTimeS: 10.4 }, c: { finishTimeS: null } } };
    const toasts = dramaEventToasts({ type: 'RIDER_FINISHED', riderIds: ['b', 'a'] }, snapshot, riders);
    expect(toasts).toEqual([
      { variant: 'finished', title: 'Ada finishes 1st!', subtitle: 'Crosses the line first' },
      { variant: 'finished', title: 'Ben finishes 2nd!', subtitle: undefined },
    ]);
  });

  it('PHOTO_FINISH is a single riderless tension toast', () => {
    const toasts = dramaEventToasts({ type: 'PHOTO_FINISH', riderIds: [] }, {}, riders);
    expect(toasts).toEqual([{ variant: 'photo-finish', title: 'Photo finish!', subtitle: 'The lead is razor-thin' }]);
  });

  it('FINAL_LAP names the rider entering their last lap', () => {
    const toasts = dramaEventToasts({ type: 'FINAL_LAP', riderIds: ['c'] }, {}, riders);
    expect(toasts).toEqual([{ variant: 'final-lap', title: 'Cy — final lap!' }]);
  });

  it('LAPPING_IMMINENT names the leader about to lap the field', () => {
    const toasts = dramaEventToasts({ type: 'LAPPING_IMMINENT', riderIds: ['a'] }, {}, riders);
    expect(toasts).toEqual([{ variant: 'lapping', title: 'Ada is about to lap the field!' }]);
  });

  it('falls back to the riderId itself when displayName is missing', () => {
    const toasts = dramaEventToasts({ type: 'LEAD_CHANGE', riderIds: ['ghost_x'] }, {}, {});
    expect(toasts).toEqual([{ variant: 'lead-change', title: 'ghost_x takes the lead!' }]);
  });

  it('an unrecognized event type produces no toasts', () => {
    expect(dramaEventToasts({ type: 'UNKNOWN', riderIds: [] }, {}, riders)).toEqual([]);
  });
});
