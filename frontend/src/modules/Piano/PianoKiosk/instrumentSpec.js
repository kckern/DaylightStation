// instrumentSpec.js — shared instrument-spec contract (UI + APK mirror this).
export const ENGINES = ['sfizz', 'dexed'];

const SAFE = (s) => typeof s === 'string' && s.length > 0
  && !s.includes('..') && !s.startsWith('/') && !s.includes('\\');

/** Validate a raw instrument definition from config. Returns {ok, error?}. */
export function validateInstrument(inst) {
  if (!inst || typeof inst !== 'object') return { ok: false, error: 'not an object' };
  if (!SAFE(inst.id)) return { ok: false, error: 'invalid id' };
  if (typeof inst.name !== 'string' || !inst.name) return { ok: false, error: 'missing name' };
  if (!ENGINES.includes(inst.engine)) return { ok: false, error: `unknown engine: ${inst.engine}` };
  if (!SAFE(inst.asset)) return { ok: false, error: 'invalid asset path' };
  return { ok: true };
}

/** Resolve a config instrument into the WS preset.load payload (defaults applied). */
export function resolveInstrumentSpec(inst) {
  return {
    id: inst.id,
    name: inst.name,
    engine: inst.engine,
    asset: inst.asset,
    patch: inst.patch ?? 0,            // dexed bank index; ignored by sfizz
    gain_db: inst.gain_db ?? 0,
    transpose: inst.transpose ?? 0,
    tune: inst.tune ?? 0,
    velocity_curve: inst.velocity_curve ?? 'natural',
    reverb: inst.reverb ?? null,
    eq: inst.eq ?? null,
    chorus: inst.chorus ?? null,
  };
}
