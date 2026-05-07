// tests/isolated/agents/health-coach/event_query/pick_series.test.mjs
import { describe, it, expect } from 'vitest';
import { pickPrimaryHrSeries } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('pickPrimaryHrSeries', () => {
  it('returns empty array for missing/null/non-object', () => {
    expect(pickPrimaryHrSeries(null)).toEqual([]);
    expect(pickPrimaryHrSeries(undefined)).toEqual([]);
    expect(pickPrimaryHrSeries({})).toEqual([]);
    expect(pickPrimaryHrSeries('oops')).toEqual([]);
  });

  it('returns the only series when one participant', () => {
    const r = pickPrimaryHrSeries({ kc: [120, 130, 140] });
    expect(r).toEqual([120, 130, 140]);
  });

  it('picks longest when multiple participants', () => {
    const r = pickPrimaryHrSeries({
      guest: [110, 115],
      kc: [120, 130, 140, 150],
      visitor: [],
    });
    expect(r).toEqual([120, 130, 140, 150]);
  });

  it('handles non-array values defensively', () => {
    const r = pickPrimaryHrSeries({ kc: 'oops', guest: [120, 130] });
    expect(r).toEqual([120, 130]);
  });
});
