import { describe, it, expect } from 'vitest';
import { dramaEventToasts, beatToasts } from "./dramaEventCopy.js";

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

describe('beatToasts', () => {
  const ahead = (gapS, extra = {}) => ({ gapM: 20, gapS, ahead: true, ...extra });
  const behind = (gapS, extra = {}) => ({ gapM: 20, gapS, ahead: false, ...extra });

  it('HALFWAY with no delta has a title only', () => {
    expect(beatToasts('HALFWAY')).toEqual([{ variant: 'halfway', title: 'Halfway' }]);
    expect(beatToasts('HALFWAY', { delta: null, rivalName: 'rider-a' })).toEqual([{ variant: 'halfway', title: 'Halfway' }]);
  });
  it('HALFWAY ahead of a named rival', () => {
    expect(beatToasts('HALFWAY', { delta: ahead(4.2), rivalName: 'rider-a', rivalKind: 'live' }))
      .toEqual([{ variant: 'halfway', title: 'Halfway', subtitle: '4 s ahead of rider-a' }]);
  });
  it('HALFWAY behind your own best', () => {
    expect(beatToasts('HALFWAY', { delta: behind(-6), rivalName: 'x', rivalKind: 'self' })[0].subtitle).toBe('6 s behind your best');
    expect(beatToasts('HALFWAY', { delta: behind(6.4), rivalKind: 'self' })[0].subtitle).toBe('6 s behind your best');
  });
  it('household rival reads as the name plus best', () => {
    expect(beatToasts('HALFWAY', { delta: ahead(3), rivalName: 'rider-a', rivalKind: 'household' })[0].subtitle).toBe("3 s ahead of rider-a's best");
  });
  it('par rival reads as par', () => {
    expect(beatToasts('HALFWAY', { delta: behind(9), rivalKind: 'par' })[0].subtitle).toBe('9 s behind par');
  });
  it('falls back to metres when there is no gapS', () => {
    expect(beatToasts('HALFWAY', { delta: { gapM: 12.6, gapS: null, ahead: true }, rivalName: 'rider-a' })[0].subtitle).toBe('13 m ahead of rider-a');
    expect(beatToasts('SPLIT', { delta: { gapM: 40.2, gapS: null, ahead: false }, rivalKind: 'self', elapsedS: 60 })[0].subtitle).toBe('40 m behind your best');
  });
  it('a rounded gap of 0 reads level', () => {
    expect(beatToasts('HALFWAY', { delta: ahead(0.3), rivalName: 'rider-a' })[0].subtitle).toBe('level with rider-a');
    expect(beatToasts('SPLIT', { delta: { gapM: 0.2, gapS: null, ahead: true }, rivalKind: 'self', elapsedS: 60 })[0].subtitle).toBe('level with your best');
  });
  it('SPLIT titles with the elapsed minute and carries the delta', () => {
    expect(beatToasts('SPLIT', { delta: ahead(4), rivalName: 'rider-a', elapsedS: 180 }))
      .toEqual([{ variant: 'split', title: '3:00', subtitle: '4 s ahead of rider-a' }]);
    expect(beatToasts('SPLIT', { delta: ahead(4), rivalName: 'rider-a', elapsedS: 60.4 })[0].title).toBe('1:00');
  });
  it('SPLIT with no delta (or no options) returns no toast', () => {
    expect(beatToasts('SPLIT', { elapsedS: 60 })).toEqual([]);
    expect(beatToasts('SPLIT', { delta: null, elapsedS: 60 })).toEqual([]);
    expect(beatToasts('SPLIT')).toEqual([]);
  });
  it('LAST_MINUTE and LAST_STRETCH have fixed titles and no subtitle', () => {
    expect(beatToasts('LAST_MINUTE')).toEqual([{ variant: 'last-minute', title: 'One minute left' }]);
    expect(beatToasts('LAST_STRETCH', { delta: ahead(4), rivalName: 'rider-a' })).toEqual([{ variant: 'last-stretch', title: 'Last stretch' }]);
  });
  it('FINAL_SECONDS and unknown beats return no toast', () => {
    expect(beatToasts('FINAL_SECONDS', { secondsLeft: 5 })).toEqual([]);
    expect(beatToasts('NOPE')).toEqual([]);
    expect(beatToasts(undefined)).toEqual([]);
  });
  it('does not throw on NaN gaps', () => {
    expect(() => beatToasts('HALFWAY', { delta: { gapM: NaN, gapS: NaN, ahead: true }, rivalName: 'rider-a' })).not.toThrow();
    expect(beatToasts('HALFWAY', { delta: { gapM: NaN, gapS: NaN, ahead: true } })).toEqual([{ variant: 'halfway', title: 'Halfway' }]);
  });
});
