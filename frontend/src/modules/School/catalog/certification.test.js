import { describe, it, expect } from 'vitest';
import { buildVerdictMap, moduleLaunchAllowed } from './certification.js';

describe('buildVerdictMap', () => {
  it('projects moduleVerdicts across rows (one surface) into Map(moduleId -> {verdict, reasons})', () => {
    const rows = [
      {
        address: 'core/quant/rates/intro/unit-rate', surfaceId: 'screen-kitchen', verdict: 'full', reasons: [], warnings: [],
        moduleVerdicts: [
          { moduleId: 'check', verdict: 'render', reasons: [], warnings: [] },
          { moduleId: 'notes', verdict: 'incompatible', reasons: ['missing-capability:audio'], warnings: [] },
        ],
      },
    ];
    const map = buildVerdictMap(rows);
    expect(map).toBeInstanceOf(Map);
    expect(map.get('check')).toEqual({ verdict: 'render', reasons: [] });
    expect(map.get('notes')).toEqual({ verdict: 'incompatible', reasons: ['missing-capability:audio'] });
    expect(map.get('nonexistent')).toBeUndefined();
  });

  it('merges moduleVerdicts across multiple rows', () => {
    const rows = [
      { moduleVerdicts: [{ moduleId: 'a', verdict: 'render', reasons: [] }] },
      { moduleVerdicts: [{ moduleId: 'b', verdict: 'incompatible', reasons: [] }] },
    ];
    const map = buildVerdictMap(rows);
    expect(map.get('a').verdict).toBe('render');
    expect(map.get('b').verdict).toBe('incompatible');
  });

  it('tolerates rows with no moduleVerdicts (bank rows) and non-array input', () => {
    expect(buildVerdictMap([{ address: 'x', verdict: 'render' }])).toEqual(new Map());
    expect(buildVerdictMap([])).toEqual(new Map());
    expect(buildVerdictMap(null)).toEqual(new Map());
    expect(buildVerdictMap(undefined)).toEqual(new Map());
  });
});

describe('moduleLaunchAllowed', () => {
  const map = new Map([
    ['check', { verdict: 'render', reasons: [] }],
    ['notes', { verdict: 'incompatible', reasons: ['missing-capability:audio'] }],
  ]);

  it('is true only for a moduleId whose verdict is render', () => {
    expect(moduleLaunchAllowed(map, 'check')).toBe(true);
  });

  it('is false for a moduleId whose verdict is incompatible', () => {
    expect(moduleLaunchAllowed(map, 'notes')).toBe(false);
  });

  it('is false, fail-closed, for a moduleId absent from the map', () => {
    expect(moduleLaunchAllowed(map, 'unknown')).toBe(false);
  });

  it('is false, fail-closed, when the verdict map is null or absent', () => {
    expect(moduleLaunchAllowed(null, 'check')).toBe(false);
    expect(moduleLaunchAllowed(undefined, 'check')).toBe(false);
  });
});
