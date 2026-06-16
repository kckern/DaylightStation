import { resolveAmbient } from '../../../frontend/src/screen-framework/widgets/resolveAmbient.js';

const curveA = [{ lux: 0, dim: 0.9 }, { lux: 100, dim: 0.2 }];
const curveB = [{ lux: 0, dim: 0.8 }, { lux: 50, dim: 0.1 }];

describe('resolveAmbient', () => {
  it('prefers screen ambient and fills its topic', () => {
    const screen = { topic: 'ambient:office', curve: curveA, defaultLux: 36 };
    expect(resolveAmbient(screen, null)).toEqual({ topic: 'ambient:office', curve: curveA, defaultLux: 36 });
  });

  it('falls back to preset ambient with a default topic when no screen ambient', () => {
    const preset = { curve: curveB, defaultLux: 80 };
    expect(resolveAmbient(null, preset)).toEqual({ topic: 'ambient', curve: curveB, defaultLux: 80 });
  });

  it('uses screen ambient over preset ambient when both present', () => {
    const screen = { topic: 'ambient:office', curve: curveA, defaultLux: 36 };
    const preset = { curve: curveB, defaultLux: 80 };
    expect(resolveAmbient(screen, preset).curve).toBe(curveA);
  });

  it('ignores ambient configs without a curve', () => {
    expect(resolveAmbient({ topic: 'x' }, null)).toBe(null);
    expect(resolveAmbient(null, { defaultLux: 5 })).toBe(null);
    expect(resolveAmbient(null, null)).toBe(null);
  });

  it('defaults defaultLux to 0 when missing or non-finite', () => {
    expect(resolveAmbient({ topic: 't', curve: curveA }, null).defaultLux).toBe(0);
    expect(resolveAmbient({ topic: 't', curve: curveA, defaultLux: 'x' }, null).defaultLux).toBe(0);
  });
});
