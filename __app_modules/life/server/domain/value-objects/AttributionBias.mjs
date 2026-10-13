const VALS = ['survivorship', 'confirmation', 'small_sample', 'regression_mean', 'confounding', 'hindsight', 'halo_effect', 'self_serving', 'luck'];
export const AttributionBias = Object.freeze({
  SURVIVORSHIP: 'survivorship', CONFIRMATION: 'confirmation', SMALL_SAMPLE: 'small_sample',
  REGRESSION_MEAN: 'regression_mean', CONFOUNDING: 'confounding', HINDSIGHT: 'hindsight',
  HALO_EFFECT: 'halo_effect', SELF_SERVING: 'self_serving', LUCK: 'luck',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
