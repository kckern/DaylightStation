import { HealthDashboardRepositoryErrorCode } from './ports/IHealthDashboardRepository.mjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const HealthDashboardOutcome = Object.freeze({
  FOUND: 'found',
  INVALID_DATE: 'invalid-date',
  NOT_FOUND: 'not-found',
  NOT_FOUND_TODAY: 'not-found-today',
  DELETED: 'deleted',
  DELETE_NOT_FOUND: 'delete-not-found',
  DELETE_FAILED: 'delete-failed',
});

/** Application orchestration for reading and deleting generated dashboards. */
export class AgentHealthDashboardService {
  #repository;
  #clock;
  #logger;

  constructor({ repository, clock, logger = console } = {}) {
    if (!repository
      || typeof repository.findByUserAndDate !== 'function'
      || typeof repository.deleteByUserAndDate !== 'function') {
      throw new Error('AgentHealthDashboardService requires repository');
    }
    if (!clock || typeof clock.now !== 'function') {
      throw new Error('AgentHealthDashboardService requires clock');
    }
    this.#repository = repository;
    this.#clock = clock;
    this.#logger = logger;
  }

  getForDate({ userId, date }) {
    if (!DATE_PATTERN.test(date)) {
      return { outcome: HealthDashboardOutcome.INVALID_DATE };
    }
    return this.#find({ userId, date, missingOutcome: HealthDashboardOutcome.NOT_FOUND });
  }

  getToday({ userId }) {
    const date = this.#clock.now().toISOString().split('T')[0];
    return this.#find({
      userId,
      date,
      missingOutcome: HealthDashboardOutcome.NOT_FOUND_TODAY,
    });
  }

  deleteForDate({ userId, date }) {
    if (!DATE_PATTERN.test(date)) {
      return { outcome: HealthDashboardOutcome.INVALID_DATE };
    }

    try {
      const deleted = this.#repository.deleteByUserAndDate(userId, date);
      if (!deleted) {
        return { outcome: HealthDashboardOutcome.DELETE_NOT_FOUND, userId, date };
      }
      this.#logger.info?.('health-dashboard.deleted', { userId, date });
      return { outcome: HealthDashboardOutcome.DELETED, userId, date };
    } catch (error) {
      if (error?.code !== HealthDashboardRepositoryErrorCode.DELETE_FAILED) throw error;
      this.#logger.error?.('health-dashboard.delete.error', {
        userId,
        date,
        error: error.cause?.message ?? error.message,
      });
      return { outcome: HealthDashboardOutcome.DELETE_FAILED };
    }
  }

  #find({ userId, date, missingOutcome }) {
    const dashboard = this.#repository.findByUserAndDate(userId, date);
    if (!dashboard) return { outcome: missingOutcome, userId, date };
    return { outcome: HealthDashboardOutcome.FOUND, userId, date, dashboard };
  }
}

export default AgentHealthDashboardService;
