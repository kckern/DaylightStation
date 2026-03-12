const DEFAULT_CHANNELS = ['app'];

export class NotificationPreference {
  #config;

  constructor(config = {}) {
    this.#config = config;
  }

  getChannelsFor(category, urgency) {
    const categoryConfig = this.#config[category];
    if (!categoryConfig) return DEFAULT_CHANNELS;

    // Try exact urgency match
    if (categoryConfig[urgency]) return categoryConfig[urgency];

    // Fall back to 'normal' urgency
    if (categoryConfig.normal) return categoryConfig.normal;

    return DEFAULT_CHANNELS;
  }

  toJSON() {
    return { ...this.#config };
  }
}
