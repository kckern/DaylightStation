export class Quality {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description || null;
    this.principles = data.principles || [];
    this.rules = data.rules || [];
    this.grounded_in = data.grounded_in || { beliefs: [], values: [] };
    this.shadow = data.shadow || null;
    this.shadow_state = data.shadow_state || 'dormant';
    this.last_shadow_check = data.last_shadow_check || null;
  }

  allGroundingRefuted(refutedBeliefIds) {
    const beliefs = this.grounded_in.beliefs || [];
    if (beliefs.length === 0) return false;
    return beliefs.every(b => refutedBeliefIds.includes(typeof b === 'string' ? b : b.id || b));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      principles: this.principles,
      rules: this.rules,
      grounded_in: this.grounded_in,
      shadow: this.shadow,
      shadow_state: this.shadow_state,
      last_shadow_check: this.last_shadow_check,
    };
  }
}
