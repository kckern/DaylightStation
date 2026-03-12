export class BeliefCascadeProcessor {
  processRefutation(belief, allBeliefs, values, qualities, purpose) {
    const cascade = {
      beliefs_questioning: [],
      values_review: [],
      qualities_review: [],
      purpose_threatened: false,
    };

    if (!belief.foundational) {
      return cascade;
    }

    // Find dependent beliefs → enter 'questioning'
    cascade.beliefs_questioning = allBeliefs
      .filter(b => b.depends_on?.includes(belief.id))
      .map(b => b.id);

    // Find values justified by this belief → flag for review
    cascade.values_review = values
      .filter(v => {
        const justifications = v.justified_by || [];
        return justifications.some(j => (j.belief || j) === belief.id);
      })
      .map(v => v.id);

    // Find qualities grounded in this belief → flag for review
    cascade.qualities_review = qualities
      .filter(q => {
        const beliefs = q.grounded_in?.beliefs || [];
        return beliefs.some(b => (typeof b === 'string' ? b : b.id || b) === belief.id);
      })
      .map(q => q.id);

    // Check if purpose is threatened
    if (purpose) {
      const purposeBeliefs = purpose.grounded_in?.beliefs || [];
      cascade.purpose_threatened = purposeBeliefs.some(
        b => (b.id || b) === belief.id
      );
    }

    return cascade;
  }

  detectParadigmCollapse(beliefs, refutedThisSeason = []) {
    const foundationalRefuted = refutedThisSeason.filter(id => {
      const belief = beliefs.find(b => b.id === id);
      return belief?.foundational;
    });
    return foundationalRefuted.length >= 3;
  }
}
