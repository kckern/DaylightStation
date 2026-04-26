/**
 * IHomeDashboardConfigRepository
 *
 * Port for loading the home-dashboard configuration.
 *
 * load(): Promise<HomeDashboardConfig>
 *   Returns a plain object shaped like data/household/config/home-dashboard.yml.
 *   Implementations own storage format and path.
 */

export function isHomeDashboardConfigRepository(obj) {
  return Boolean(obj) && typeof obj.load === 'function';
}

export function assertHomeDashboardConfigRepository(obj) {
  if (!isHomeDashboardConfigRepository(obj)) {
    throw new Error('Object does not implement IHomeDashboardConfigRepository');
  }
}

export default { isHomeDashboardConfigRepository, assertHomeDashboardConfigRepository };
