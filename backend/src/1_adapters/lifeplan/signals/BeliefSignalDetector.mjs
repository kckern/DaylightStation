/**
 * Evaluates belief signals against lifelog data.
 * Takes a belief with if_signal/then_signal definitions and
 * checks whether the if condition was met and the expected
 * then outcome occurred.
 */
export class BeliefSignalDetector {
  detectSignals(belief, lifelogDays) {
    if (!belief.if_signal || !belief.then_signal) return [];

    const evidence = [];

    for (const [date, day] of Object.entries(lifelogDays || {})) {
      const didIf = this.#evaluateCondition(belief.if_signal, day);
      const gotThen = this.#evaluateCondition(belief.then_signal, day);

      if (didIf) {
        const type = gotThen ? 'confirmation' : 'disconfirmation';
        evidence.push({
          date,
          type,
          did_if: true,
          got_then: gotThen,
          note: `${belief.if_signal.description || 'If condition'} → ${gotThen ? 'outcome observed' : 'outcome NOT observed'}`,
        });
      }
    }

    return evidence;
  }

  #evaluateCondition(signal, dayData) {
    if (!signal || !dayData) return false;

    // Source-based: check if a specific source has data
    if (signal.source) {
      const sourceData = dayData.sources?.[signal.source];
      if (!sourceData) return false;

      // Threshold check
      if (signal.measure && signal.threshold !== undefined) {
        const value = sourceData[signal.measure];
        return value !== undefined && value >= signal.threshold;
      }

      return true; // Source exists = condition met
    }

    // Category-based: check if any source in category has data
    if (signal.category) {
      const catData = dayData.categories?.[signal.category];
      return catData && Object.keys(catData).length > 0;
    }

    // Summary text match
    if (signal.keyword) {
      const summaries = dayData.summaries || [];
      return summaries.some(s =>
        s.text?.toLowerCase().includes(signal.keyword.toLowerCase())
      );
    }

    return false;
  }
}
