/**
 * Application-owned persistence contract for agent-generated health dashboards.
 *
 * Implementations keep filesystem paths and serialization details outside the
 * application and API layers.
 */
export class IHealthDashboardRepository {
  findByUserAndDate(_userId, _date) {
    throw new Error('IHealthDashboardRepository.findByUserAndDate must be implemented');
  }

  deleteByUserAndDate(_userId, _date) {
    throw new Error('IHealthDashboardRepository.deleteByUserAndDate must be implemented');
  }
}

export const HealthDashboardRepositoryErrorCode = Object.freeze({
  DELETE_FAILED: 'HEALTH_DASHBOARD_DELETE_FAILED',
});

export default IHealthDashboardRepository;
