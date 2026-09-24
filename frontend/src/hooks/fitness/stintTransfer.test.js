import { describe, it, expect } from 'vitest';
import { moveStintSeries } from './stintTransfer.js';

const S = (o) => JSON.parse(JSON.stringify(o));

describe('moveStintSeries', () => {
  it('moves point cells in the window and blanks the source', () => {
    const series = S({ 'user:a:heart_rate': [90, 91, 120, 130], 'user:a:zone_id': ['cool', 'cool', 'warm', 'hot'] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 2 });
    expect(series['user:a:heart_rate']).toEqual([90, 91, null, null]);
    expect(series['user:b:heart_rate']).toEqual([null, null, 120, 130]);
    expect(series['user:b:zone_id']).toEqual([null, null, 'warm', 'hot']);
  });

  it('moves cumulative increments, flattening the source at its base', () => {
    const series = S({ 'user:a:rings_total': [0, 2, 5, 9], 'user:b:rings_total': [0, 1, 1, 1] });
    const { bases } = moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 2 });
    expect(bases.rings_total).toBe(2);
    expect(series['user:a:rings_total']).toEqual([0, 2, 2, 2]);
    expect(series['user:b:rings_total']).toEqual([0, 1, 4, 8]);
  });

  it('never produces a decreasing destination when it had no prior series', () => {
    const series = S({ 'user:a:rings_total': [0, 40, 88, 88] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 1 });
    expect(series['user:b:rings_total']).toEqual([null, 40, 88, 88]);
    expect(series['user:a:rings_total']).toEqual([0, 0, 0, 0]);
  });

  it('destination with own concurrent data keeps its cells', () => {
    const series = S({ 'user:a:heart_rate': [null, 120, 121], 'user:b:heart_rate': [100, 101, null] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 1 });
    expect(series['user:b:heart_rate']).toEqual([100, 101, 121]);
  });

  it('leaves non-person metrics (mat steps) alone', () => {
    const series = S({ 'user:a:steps_total': [1, 2, 3] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 0 });
    expect(series['user:a:steps_total']).toEqual([1, 2, 3]);
    expect(series['user:b:steps_total']).toBeUndefined();
  });

  it('is a no-op for identical or missing ids', () => {
    const series = S({ 'user:a:heart_rate': [1] });
    expect(moveStintSeries(series, { fromUserId: 'a', toUserId: 'a', startIndex: 0 }).movedKeys).toEqual([]);
    expect(moveStintSeries(series, { fromUserId: null, toUserId: 'b', startIndex: 0 }).movedKeys).toEqual([]);
  });
});
