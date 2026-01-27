// backend/src/2_adapters/persistence/yaml/YamlNutriLogDatastore.mjs
import { NutriLog } from '#domains/lifelog/entities/NutriLog.mjs';
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { INutriLogDatastore } from '#apps/nutribot/ports/INutriLogDatastore.mjs';

/**
 * YAML-based NutriLog persistence adapter
 * Implements INutriLogDatastore port
 */
export class YamlNutriLogDatastore extends INutriLogDatastore {
  #userDataService;
  #logger;

  constructor(config) {
    super();
    if (!config.userDataService) {
      throw new Error('YamlNutriLogDatastore requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#logger = config.logger || console;
  }

  #getPath(userId) {
    return this.#userDataService.getUserPath(userId, 'lifelog/nutrition/nutrilog');
  }

  #loadLogs(userId) {
    const path = this.#getPath(userId);
    const data = loadYaml(path);
    return data || {};
  }

  #saveLogs(userId, logs) {
    const path = this.#getPath(userId);
    saveYaml(path, logs);
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
