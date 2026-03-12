const VALS = ['blocks', 'derails', 'invalidates', 'transforms', 'cascades'];
export const LifeEventImpact = Object.freeze({
  BLOCKS: 'blocks', DERAILS: 'derails', INVALIDATES: 'invalidates',
  TRANSFORMS: 'transforms', CASCADES: 'cascades',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
