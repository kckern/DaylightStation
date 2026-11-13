import { createChartDataSource } from "./sessionDataAdapter.js";
import { buildBeatsSeries } from "../../lib/chartHelpers.js";

/**
 * A rider who earned no rings has no `<id>:rings` series on disk: the
 * persistence layer drops every all-zero series (PersistenceManager.encodeSeries).
 * The replayed race chart then fell through to the legacy `heart_beats`
 * fallback and drew the rider's cumulative HEARTBEATS as a ring score — an
 * all-cool 70-second warm-up showed "118 rings" while the record said 0.
 *
 * On a saved session a missing rings series means zero rings, never "use
 * heartbeats instead". Identities are synthetic.
 */

const coolOnlySession = () => ({
  participants: { 'rider-a': { display_name: 'rider-a' } },
  timeline: {
    interval_seconds: 5,
    tick_count: 6,
    series: {
      // decoded shape the detail API returns; no `rider-a:rings` (all zero → dropped)
      'rider-a:hr': [90, 88, 100, 110, 113, null],
      'rider-a:zone': ['c', 'c', 'c', 'c', 'c', null],
      'rider-a:beats': [7.5, 15, 22.5, 109.2, 118.6, 118.6],
    },
  },
});

describe('sessionDataAdapter — a rider with no rings series earned zero rings', () => {
  it('serves a zero rings series, not nothing', () => {
    const { getSeries } = createChartDataSource(coolOnlySession());
    const rings = getSeries('rider-a', 'rings_total', { clone: true });
    expect(rings).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('the replayed race chart plots 0 rings, not the heartbeat total', () => {
    const { getSeries, roster, timebase } = createChartDataSource(coolOnlySession());
    const { beats } = buildBeatsSeries(roster[0], getSeries, timebase);
    const plotted = Math.max(0, ...beats.filter(Number.isFinite));
    expect(plotted).toBe(0);
  });

  it('leaves a real rings series untouched', () => {
    const session = coolOnlySession();
    session.timeline.series['rider-a:rings'] = [0, 1, 2, 3, 4, 4];
    const { getSeries, roster, timebase } = createChartDataSource(session);
    expect(getSeries('rider-a', 'rings_total')).toEqual([0, 1, 2, 3, 4, 4]);
    const { beats } = buildBeatsSeries(roster[0], getSeries, timebase);
    expect(Math.max(...beats.filter(Number.isFinite))).toBe(4);
  });
});
