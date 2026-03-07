/**
 * TodoistHarvester
 *
 * Fetches task data from Todoist API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Open tasks fetched via Todoist API v1 (current data)
 * - Completed tasks via API v1 /tasks/completed (lifelog data)
 * - Date-keyed merging with composite id+action deduplication
 *
 * @module harvester/productivity/TodoistHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Todoist task harvester
 * @implements {IHarvester}
 */
export class TodoistHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #currentStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;
  #addedAtCache = new Map();

  /** @type {string} Base URL for Todoist API v1 */
  static API_BASE = 'https://api.todoist.com/api/v1';

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client (axios-compatible)
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} [config.currentStore] - Store for current data YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    todoistApi, // deprecated, ignored — kept for backwards compat
    httpClient,
    lifelogStore,
    currentStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!lifelogStore) {
      throw new InfrastructureError('TodoistHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#httpClient = httpClient;
    this.#lifelogStore = lifelogStore;
    this.#currentStore = currentStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'todoist';
  }

  get category() {
    return HarvesterCategory.PRODUCTIVITY;
  }

  /**
   * Harvest tasks from Todoist
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=7] - Days of history to fetch for lifelog
   * @returns {Promise<{ current: number, lifelog: { created: number, completed: number }, status: string }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = 7 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('todoist.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        current: 0,
        lifelog: { created: 0, completed: 0 },
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('todoist.harvest.start', { username, daysBack });

      // Get API key
      const auth = this.#configService?.getUserAuth?.('todoist', username) || {};
      const apiKey = auth.api_key || configService.getSecret('TODOIST_KEY');

      if (!apiKey) {
        throw new InfrastructureError('Todoist API key not found', {
          code: 'MISSING_CONFIG',
          service: 'Todoist',
          field: 'api_key'
        });
      }

      const authHeaders = { Authorization: `Bearer ${apiKey}` };
      const lifelogTasks = [];
      const cutoffDate = moment().subtract(daysBack, 'days');

      // === CURRENT DATA: Open tasks via API v1 ===
      let currentCount = 0;
      if (this.#httpClient) {
        const tasksResponse = await this.#httpClient.get(
          `${TodoistHarvester.API_BASE}/tasks`,
          { headers: authHeaders }
        );
        const tasks = tasksResponse.data?.results || [];
        const currentTasks = tasks.map(task => ({
          id: task.id,
          content: task.content,
          description: task.description,
          priority: task.priority,
          dueDate: task.due?.date || null,
          dueString: task.due?.string || null,
          projectId: task.project_id,
          labels: task.labels,
        }));

        if (this.#currentStore) {
          await this.#currentStore.save(username, 'todoist', {
            lastUpdated: nowTs24(),
            taskCount: currentTasks.length,
            tasks: currentTasks,
          });
        }
        currentCount = currentTasks.length;

        // Derive "created" lifelog entries from added_at on open tasks
        // Store addedAt so it survives after task completion (completed API lacks it)
        const createdFromOpen = tasks
          .filter(t => t.added_at && moment(t.added_at).isAfter(cutoffDate))
          .map(t => ({
            id: t.id,
            content: t.content,
            time: moment(t.added_at).tz(this.#timezone).format('HH:mm'),
            date: moment(t.added_at).tz(this.#timezone).format('YYYY-MM-DD'),
            addedAt: t.added_at,
            projectId: t.project_id,
            action: 'created',
          }));
        lifelogTasks.push(...createdFromOpen);

        // Also stash addedAt into a lookup so completed entries can reference it
        for (const t of tasks) {
          if (t.added_at) {
            this.#addedAtCache.set(t.id, t.added_at);
          }
        }
      }

      // === LIFELOG DATA: Completed tasks via API v1 ===
      if (this.#httpClient) {
        try {
          const completedResponse = await this.#httpClient.get(
            `${TodoistHarvester.API_BASE}/tasks/completed`,
            { headers: authHeaders }
          );

          const completedItems = completedResponse.data?.items || [];
          for (const item of completedItems) {
            if (item.completed_at && moment(item.completed_at).isAfter(cutoffDate)) {
              const entry = {
                id: item.task_id,
                content: item.content,
                time: moment(item.completed_at).tz(this.#timezone).format('HH:mm'),
                date: moment(item.completed_at).tz(this.#timezone).format('YYYY-MM-DD'),
                projectId: item.project_id,
                action: 'completed',
              };
              // Preserve addedAt from cache (open tasks) or existing lifelog
              const cachedAddedAt = this.#addedAtCache.get(item.task_id);
              if (cachedAddedAt) entry.addedAt = cachedAddedAt;
              lifelogTasks.push(entry);
            }
          }
        } catch (error) {
          this.#logger.warn?.('todoist.completed.error', {
            username,
            error: error.message,
            status: error.response?.status,
          });
        }
      }

      // Merge into existing lifelog
      const existingLifelog = await this.#lifelogStore.load(username, 'todoist') || {};
      const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
      const updatedLifelog = this.#mergeTasksByDate(existingDateKeyed, lifelogTasks);

      // Sort by date (newest first)
      const sortedLifelog = this.#sortByDate(updatedLifelog);
      await this.#lifelogStore.save(username, 'todoist', sortedLifelog);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const createdCount = lifelogTasks.filter(t => t.action === 'created').length;
      const completedCount = lifelogTasks.filter(t => t.action === 'completed').length;

      this.#logger.info?.('todoist.harvest.complete', {
        username,
        current: currentCount,
        lifelog: { created: createdCount, completed: completedCount },
      });

      // Get latest date from lifelog (keys sorted descending)
      const latestDate = Object.keys(sortedLifelog).sort().reverse()[0] || null;

      return {
        current: currentCount,
        lifelog: { created: createdCount, completed: completedCount },
        status: 'success',
        latestDate,
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429 || statusCode === 401 || statusCode === 410) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('todoist.harvest.error', {
        username,
        error: error.message,
        statusCode,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Get available harvest parameters
   * @returns {HarvesterParam[]}
   */
  getParams() {
    return [
      { name: 'daysBack', type: 'number', default: 7, description: 'Days of history to fetch for lifelog' },
    ];
  }

  /**
   * Merge tasks by date with composite key deduplication
   * @private
   */
  #mergeTasksByDate(existing, newTasks) {
    const merged = { ...existing };

    // Build addedAt index from existing entries so completed entries inherit it
    const addedAtIndex = new Map();
    for (const entries of Object.values(existing)) {
      for (const e of entries) {
        if (e.addedAt && e.id) addedAtIndex.set(e.id, e.addedAt);
      }
    }

    for (const task of newTasks) {
      if (!task.date) continue;

      if (!merged[task.date]) {
        merged[task.date] = [];
      }

      // Inherit addedAt from existing lifelog if not already set
      if (!task.addedAt && addedAtIndex.has(task.id)) {
        task.addedAt = addedAtIndex.get(task.id);
      }
      // Update index for future lookups within this merge
      if (task.addedAt) addedAtIndex.set(task.id, task.addedAt);

      // Use composite key of id + action for deduplication
      const isDupe = merged[task.date].find(
        t => t.id === task.id && t.action === task.action
      );

      if (!isDupe) {
        merged[task.date].push(task);
      }
    }

    // Sort each day's tasks by time
    for (const date of Object.keys(merged)) {
      merged[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }

    return merged;
  }

  /**
   * Sort lifelog by date (newest first)
   * @private
   */
  #sortByDate(data) {
    const sortedDates = Object.keys(data).sort((a, b) => new Date(b) - new Date(a));
    const sorted = {};

    for (const date of sortedDates) {
      if (data[date].length > 0) {
        sorted[date] = data[date];
      }
    }

    return sorted;
  }
}

export default TodoistHarvester;
