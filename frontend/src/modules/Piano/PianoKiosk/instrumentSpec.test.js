import { validateInstrument, resolveInstrumentSpec, ENGINES } from './instrumentSpec.js';

describe('validateInstrument', () => {
  it('accepts a valid sfizz instrument', () => {
    const r = validateInstrument({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(r.ok).toBe(true);
  });
  it('rejects unknown engine', () => {
    const r = validateInstrument({ id: 'g', name: 'G', engine: 'reaktor', asset: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/engine/);
  });
  it('rejects missing id/asset', () => {
    expect(validateInstrument({ name: 'x', engine: 'sfizz', asset: 'a' }).ok).toBe(false);
    expect(validateInstrument({ id: 'x', name: 'x', engine: 'sfizz' }).ok).toBe(false);
  });
  it('rejects path traversal in asset', () => {
    expect(validateInstrument({ id: 'g', name: 'G', engine: 'sfizz', asset: '../etc/x' }).ok).toBe(false);
  });
  it('rejects path traversal in id', () => {
    expect(validateInstrument({ id: '../x', name: 'X', engine: 'sfizz', asset: 'a.sfz' }).ok).toBe(false);
    expect(validateInstrument({ id: '/abs', name: 'X', engine: 'sfizz', asset: 'a.sfz' }).ok).toBe(false);
  });

  // --- extra tests for confidence ---
  it('rejects absolute asset path', () => {
    expect(validateInstrument({ id: 'g', name: 'G', engine: 'sfizz', asset: '/etc/passwd' }).ok).toBe(false);
  });
  it('rejects backslash traversal in asset', () => {
    expect(validateInstrument({ id: 'g', name: 'G', engine: 'sfizz', asset: 'foo\\bar' }).ok).toBe(false);
  });
  it('accepts a normal dexed instrument with underscore id', () => {
    const r = validateInstrument({ id: 'dx7_rhodes', name: 'DX7 Rhodes', engine: 'dexed', asset: 'banks/rhodes.syx' });
    expect(r.ok).toBe(true);
  });
  it('exposes the supported engines', () => {
    expect(ENGINES).toEqual(['sfizz', 'dexed']);
  });
  it('rejects non-object input', () => {
    expect(validateInstrument(null).ok).toBe(false);
    expect(validateInstrument('nope').ok).toBe(false);
  });
});

describe('resolveInstrumentSpec', () => {
  it('produces the WS preset.load payload with defaults applied', () => {
    const spec = resolveInstrumentSpec({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(spec).toMatchObject({ id: 'g', engine: 'sfizz', asset: 'x.sfz', gain_db: 0, transpose: 0 });
  });

  // --- extra tests for confidence ---
  it('carries velocity_curve default of natural', () => {
    const spec = resolveInstrumentSpec({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(spec.velocity_curve).toBe('natural');
  });
  it('passes through dexed patch index', () => {
    const spec = resolveInstrumentSpec({ id: 'dx7_rhodes', name: 'DX7 Rhodes', engine: 'dexed', asset: 'banks/rhodes.syx', patch: 12 });
    expect(spec.patch).toBe(12);
  });
  it('passes through provided overrides instead of defaults', () => {
    const spec = resolveInstrumentSpec({
      id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz',
      gain_db: -3, transpose: 12, tune: 5, velocity_curve: 'hard',
      reverb: { wet: 0.2 }, eq: { low: 1 }, chorus: { depth: 0.5 },
    });
    expect(spec).toMatchObject({
      gain_db: -3, transpose: 12, tune: 5, velocity_curve: 'hard',
      reverb: { wet: 0.2 }, eq: { low: 1 }, chorus: { depth: 0.5 },
    });
  });
  it('defaults effect slots to null', () => {
    const spec = resolveInstrumentSpec({ id: 'g', name: 'Grand', engine: 'sfizz', asset: 'x.sfz' });
    expect(spec.reverb).toBeNull();
    expect(spec.eq).toBeNull();
    expect(spec.chorus).toBeNull();
  });
});
