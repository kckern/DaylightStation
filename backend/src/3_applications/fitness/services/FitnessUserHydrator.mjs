/** Fitness-specific projection over generic user profiles. */
export class FitnessUserHydrator {
  constructor({ profileReader, logger = console } = {}) {
    if (!profileReader?.getProfile) throw new Error('FitnessUserHydrator requires profileReader');
    this.profileReader = profileReader;
    this.logger = logger;
  }

  hydrateUsers(userList, deviceMappings = {}) {
    if (!Array.isArray(userList)) return [];
    return userList.map((entry) => {
      if (typeof entry === 'object' && entry !== null) return entry;
      const username = String(entry);
      const profile = this.profileReader.getProfile(username);
      if (!profile) {
        this.logger.warn?.('fitness.user.profile_not_found', { username });
        return { id: username, name: username };
      }
      const fitness = profile.apps?.fitness;
      const hydrated = {
        id: profile.username || username,
        profileId: profile.username || username,
        name: profile.display_name || profile.username || username,
        birthyear: profile.birthyear,
        group_label: profile.group_label,
      };
      if (fitness?.heart_rate_zones) hydrated.zones = fitness.heart_rate_zones;
      if (fitness?.max_heart_rate) hydrated.max_heart_rate = fitness.max_heart_rate;
      if (fitness?.resting_heart_rate) hydrated.resting_heart_rate = fitness.resting_heart_rate;
      if (fitness?.cadence_zones) hydrated.cadence_zones = fitness.cadence_zones;
      this.#attachHeartRateDevices(hydrated, username, deviceMappings);
      return hydrated;
    }).filter(Boolean);
  }

  hydrateConfig(fitnessConfig) {
    if (!fitnessConfig) return fitnessConfig;
    const hydrated = { ...fitnessConfig };
    const deviceMappings = fitnessConfig.devices || {};
    if (fitnessConfig.users) {
      hydrated.users = { ...fitnessConfig.users };
      if (Array.isArray(fitnessConfig.users.primary)) {
        hydrated.users.primary = this.hydrateUsers(fitnessConfig.users.primary, deviceMappings);
      }
      const hydrateInline = (user) => {
        if (!user.id) {
          this.logger.warn?.('fitness.user.inline_id_missing', { name: user.name });
          return null;
        }
        const copy = { ...user };
        this.#attachHeartRateDevices(copy, user.id, deviceMappings);
        return copy;
      };
      if (Array.isArray(fitnessConfig.users.family)) {
        hydrated.users.family = fitnessConfig.users.family.map(hydrateInline).filter(Boolean);
      }
      if (Array.isArray(fitnessConfig.users.friends)) {
        hydrated.users.friends = fitnessConfig.users.friends.map(hydrateInline).filter(Boolean);
      }
    }
    if (fitnessConfig.devices && fitnessConfig.device_colors) {
      hydrated.ant_devices = {
        ...fitnessConfig.ant_devices,
        hr: fitnessConfig.device_colors.heart_rate || {},
        cadence: fitnessConfig.device_colors.cadence || {},
      };
    }
    return hydrated;
  }

  #attachHeartRateDevices(target, userId, mappings) {
    if (!mappings.heart_rate || target.hr) return;
    const matched = Object.entries(mappings.heart_rate)
      .filter(([, mappedUser]) => mappedUser === userId)
      .map(([deviceId]) => parseInt(deviceId, 10));
    if (matched.length) {
      target.hr = matched[0];
      target.hr_device_ids = matched;
    }
  }
}

export default FitnessUserHydrator;
