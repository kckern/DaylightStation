import { describe, expect, it } from 'vitest';
import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  DEFAULT_ISOLATED_PATHS,
  isCrossOriginIsolatedPath,
  resolveCrossOriginIsolationPolicy,
} from './crossOriginIsolation.mjs';

describe('cross-origin isolation policy', () => {
  it('uses credentialless, not require-corp', () => {
    expect(CROSS_ORIGIN_ISOLATION_HEADERS).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
  });

  it('defaults ON for fitness and its sim panel when nothing is configured', () => {
    for (const config of [null, undefined, {}, { cross_origin_isolation: {} }, { cross_origin_isolation: null }]) {
      expect(resolveCrossOriginIsolationPolicy(config, {})).toEqual({
        enabled: true, paths: ['/fitness', '/sim-panel.html'], source: 'default',
      });
    }
  });

  it('turns off only on an explicit enabled:false', () => {
    expect(resolveCrossOriginIsolationPolicy({ cross_origin_isolation: { enabled: false } }, {}))
      .toEqual({ enabled: false, paths: [], source: 'config' });
    expect(resolveCrossOriginIsolationPolicy({ cross_origin_isolation: { enabled: 'false' } }, {}).enabled).toBe(true);
    expect(resolveCrossOriginIsolationPolicy({ cross_origin_isolation: { enabled: true } }, {}).enabled).toBe(true);
  });

  it('lets the env kill switch win over config', () => {
    for (const value of ['off', 'OFF', '0', 'false', ' disabled ']) {
      expect(resolveCrossOriginIsolationPolicy(
        { cross_origin_isolation: { enabled: true } },
        { DAYLIGHT_CROSS_ORIGIN_ISOLATION: value }
      )).toEqual({ enabled: false, paths: [], source: 'env' });
    }
    expect(resolveCrossOriginIsolationPolicy({}, { DAYLIGHT_CROSS_ORIGIN_ISOLATION: 'on' }).enabled).toBe(true);
    expect(resolveCrossOriginIsolationPolicy({}, { DAYLIGHT_CROSS_ORIGIN_ISOLATION: '' }).enabled).toBe(true);
  });

  it('normalizes configured paths and drops unusable ones', () => {
    const policy = resolveCrossOriginIsolationPolicy(
      { cross_origin_isolation: { paths: ['/fitness/', 'piano', '/', 7, '/fitness', ' /sim-panel.html '] } }, {}
    );
    expect(policy).toEqual({ enabled: true, paths: ['/fitness', '/sim-panel.html'], source: 'config' });
  });

  it('falls back to the defaults when the configured list is empty or all junk', () => {
    for (const paths of [[], ['/'], ['nope'], 'fitness']) {
      expect(resolveCrossOriginIsolationPolicy({ cross_origin_isolation: { paths } }, {}).paths)
        .toEqual([...DEFAULT_ISOLATED_PATHS]);
    }
  });

  it('matches whole path segments only', () => {
    const yes = ['/fitness', '/fitness/', '/fitness/menu/1', '/sim-panel.html'];
    const no = ['/', '/fitnessx', '/api/v1/fitness', '/tv/fitness', '/sim-panel.htmlx', '/piano', undefined, null];
    for (const path of yes) expect(isCrossOriginIsolatedPath(path), String(path)).toBe(true);
    for (const path of no) expect(isCrossOriginIsolatedPath(path), String(path)).toBe(false);
    expect(isCrossOriginIsolatedPath('/fitness', [])).toBe(false);
    expect(isCrossOriginIsolatedPath('/fitness', null)).toBe(false);
  });
});
