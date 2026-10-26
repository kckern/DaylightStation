// Policy consumes a normalized authored round. Omitted DD policy preserves
// the historical ordinary-penalty inheritance, including no-loss family games.
export function jeopardyScoringPolicy(round) {
  return {
    ordinaryWrongDeducts: Boolean(round?.penalize_wrong),
    dailyDoubleWrongDeducts: Boolean(round?.daily_double_penalize_wrong ?? round?.penalize_wrong),
    finalWrongDeducts: true,
  };
}

export function validateJeopardyScoringMetadata(definition) {
  const errors = [];
  for (const [index, round] of (Array.isArray(definition?.rounds) ? definition.rounds : []).entries()) {
    if (round && Object.hasOwn(round, 'daily_double_penalize_wrong') && typeof round.daily_double_penalize_wrong !== 'boolean') {
      errors.push(`rounds[${index}].daily_double_penalize_wrong must be a boolean`);
    }
  }
  return errors;
}
