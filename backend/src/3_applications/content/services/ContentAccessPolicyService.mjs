/** Application query for schedule and launch-device policy. */
export class ContentAccessPolicyService {
  constructor({ loadSourceConfig, checkSchedule }) {
    this.loadSourceConfig = loadSourceConfig;
    this.checkSchedule = checkSchedule;
  }
  schedule() {
    const schedule = this.loadSourceConfig('games')?.schedule;
    const status = typeof this.checkSchedule === 'function'
      ? this.checkSchedule(schedule)
      : { available: true, nextWindow: null };
    return { ...status, schedule: schedule || null };
  }
  launchTargets(source) {
    const configName = source === 'retroarch' ? 'games' : source;
    const raw = this.loadSourceConfig(configName)?.launch?.device_targets || {};
    return Object.entries(raw).map(([deviceId, cfg]) => ({
      deviceId,
      allow: Array.isArray(cfg?.allow) ? cfg.allow.filter(Boolean) : [],
    }));
  }
}
export default ContentAccessPolicyService;
