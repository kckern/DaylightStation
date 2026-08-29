import { deleteFileStrict, fileExists } from '#system/utils/FileIO.mjs';
import {
  HealthDashboardRepositoryErrorCode,
  IHealthDashboardRepository,
} from '#apps/health/ports/IHealthDashboardRepository.mjs';

const dashboardKey = (date) => `health-dashboard/${date}`;

/** DataService/FileIO implementation of the health-dashboard persistence port. */
export class DataServiceHealthDashboardRepository extends IHealthDashboardRepository {
  #userData;

  constructor({ dataService } = {}) {
    super();
    if (!dataService?.user
      || typeof dataService.user.read !== 'function'
      || typeof dataService.user.resolvePath !== 'function') {
      throw new Error('DataServiceHealthDashboardRepository requires dataService');
    }
    this.#userData = dataService.user;
  }

  findByUserAndDate(userId, date) {
    return this.#userData.read(dashboardKey(date), userId);
  }

  deleteByUserAndDate(userId, date) {
    const filePath = this.#userData.resolvePath(dashboardKey(date), userId);
    try {
      if (!fileExists(filePath)) return false;
      deleteFileStrict(filePath);
      return true;
    } catch (error) {
      const repositoryError = new Error('Failed to delete health dashboard', { cause: error });
      repositoryError.name = 'HealthDashboardRepositoryError';
      repositoryError.code = HealthDashboardRepositoryErrorCode.DELETE_FAILED;
      throw repositoryError;
    }
  }
}

export default DataServiceHealthDashboardRepository;
