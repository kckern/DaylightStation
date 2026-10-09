/**
 * Processes past experiences to extract beliefs and update qualities.
 * Used during onboarding or periodic deep reflection.
 */
export class PastProcessingService {
  extractBeliefsFromExperience(experience) {
    const beliefs = [];

    if (experience.lesson) {
      beliefs.push({
        if_hypothesis: experience.situation || experience.context,
        then_expectation: experience.lesson,
        confidence: 0.6,
        state: 'hypothesized',
        origin: {
          type: 'experience',
          description: experience.description,
          date: experience.date,
        },
        foundational: experience.foundational || false,
      });
    }

    return beliefs;
  }

  suggestQualityFromPattern(pattern) {
    if (!pattern.behavior || !pattern.outcome) return null;

    return {
      name: pattern.name,
      principles: pattern.principles || [],
      rules: pattern.rules || [{
        trigger: pattern.trigger || pattern.behavior,
        action: pattern.action || pattern.outcome,
        times_triggered: 0,
        times_followed: 0,
        times_helped: 0,
      }],
      shadow: pattern.shadow || null,
      grounded_in: pattern.grounded_in || [],
    };
  }

  processNarrative(narrative) {
    const entries = [];

    for (const event of (narrative.events || [])) {
      const entry = {
        type: event.type || 'observation',
        date: event.date,
        description: event.description,
      };

      if (event.emotion) entry.emotion = event.emotion;
      if (event.lesson) entry.lesson = event.lesson;
      if (event.impact) entry.impact = event.impact;

      entries.push(entry);
    }

    return {
      entries,
      suggestedBeliefs: entries
        .filter(e => e.lesson)
        .map(e => this.extractBeliefsFromExperience(e))
        .flat(),
    };
  }
}
