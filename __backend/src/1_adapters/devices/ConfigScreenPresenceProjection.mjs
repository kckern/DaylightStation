export class ConfigScreenPresenceProjection {
  constructor({ devicesConfig = {} } = {}) { this.devicesConfig = devicesConfig; }
  read() {
    return Object.fromEntries(Object.entries(this.devicesConfig)
      .filter(([, config]) => config?.presence?.entity)
      .map(([deviceId, config]) => [deviceId, { entity: config.presence.entity, ttlMs: config.presence.ttlMs }]));
  }
}
