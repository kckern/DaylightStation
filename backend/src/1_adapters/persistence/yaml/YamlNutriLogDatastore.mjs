// backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs
import { NutriLog } from '#domains/lifelog/entities/NutriLog.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { INutriLogDatastore } from '#apps/nutribot/ports/INutriLogDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const NUTRILOG_PATH = 'lifelog/nutrition/nutrilog';

/**
 * YAML-based NutriLog persistence adapter
 * Implements INutriLogDatastore port
 *
 * Uses DataService for filesystem abstraction - adapter does not
 * interact with filesystem directly.
 */
export class YamlNutriLogDatastore extends INutriLogDatastore {
  #dataService;
  #logger;

  constructor(config) {
    super();
    if (!config.dataService) {
      throw new InfrastructureError('YamlNutriLogDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = config.dataService;
    this.#logger = config.logger || console;
  }

  #loadLogs(userId) {
    const data = this.#dataService.user.read(NUTRILOG_PATH, userId);
    return data || {};
  }

  #saveLogs(userId, logs) {
    const result = this.#dataService.user.write(NUTRILOG_PATH, logs, userId);
    if (!result) {
      this.#logger.error?.('nutrilog.save.failed', { userId });
    }
    return result;
  }

  async save(nutriLog) {
    const logs = this.#loadLogs(nutriLog.userId);
    logs[nutriLog.id] = nutriLog.toJSON();
    this.#saveLogs(nutriLog.userId, logs);

    this.#logger.debug?.('nutrilog.saved', {
      userId: nutriLog.userId,
      logId: nutriLog.id,
      status: nutriLog.status
    });

    return nutriLog;
  }

  async findById(userId, id) {
    const logs = this.#loadLogs(userId);
    const data = logs[id];
    return data ? NutriLog.fromJSON(data) : null;
  }

  async findByDate(userId, date) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.meal?.date === date && log.status !== 'deleted')
      .map(log => NutriLog.fromJSON(log));
  }

  async findByDateRange(userId, startDate, endDate) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => {
        const date = log.meal?.date;
        return date >= startDate && date <= endDate && log.status !== 'deleted';
      })
      .map(log => NutriLog.fromJSON(log));
  }

  async findPending(userId) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.status === 'pending')
      .map(log => NutriLog.fromJSON(log));
  }

  async findAccepted(userId) {
    const logs = this.#loadLogs(userId);
    return Object.values(logs)
      .filter(log => log.status === 'accepted')
      .map(log => NutriLog.fromJSON(log));
  }

  async updateStatus(userId, id, status) {
    const logs = this.#loadLogs(userId);
    if (!logs[id]) return null;

    logs[id].status = status;
    logs[id].updatedAt = nowTs24();
    if (status === 'accepted') {
      logs[id].acceptedAt = nowTs24();
    }

    this.#saveLogs(userId, logs);
    return NutriLog.fromJSON(logs[id]);
  }

  async delete(userId, id) {
    return this.updateStatus(userId, id, 'deleted');
  }

  async count(userId, options = {}) {
    const logs = this.#loadLogs(userId);
    let items = Object.values(logs);

    if (options.status) {
      items = items.filter(log => log.status === options.status);
    }
    if (options.date) {
      items = items.filter(log => log.meal?.date === options.date);
    }

    return items.length;
  }
}

export default YamlNutriLogDatastore;
