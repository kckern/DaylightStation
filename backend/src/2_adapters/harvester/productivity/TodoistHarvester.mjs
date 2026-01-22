/**
 * TodoistHarvester
 *
 * Fetches task data from Todoist API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Open tasks fetched via official API (current data)
 * - Created/completed tasks via Activity API (lifelog data)
 * - Date-keyed merging with composite id+action deduplication
 *
 * @module harvester/productivity/TodoistHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_infrastructure/config/index.mjs';

/**
 * Todoist task harvester
 * @implements {IHarvester}
 */
export class TodoistHarvester extends IHarvester {
  #todoistApi;
  #httpClient;
  #lifelogStore;
  #currentStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.todoistApi - Todoist API client instance
   * @param {Object} config.httpClient - HTTP client for Activity API
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} [config.currentStore] - Store for current data YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    todoistApi,
    httpClient,
    lifelogStore,
    currentStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!lifelogStore) {
      throw new Error('TodoistHarvester requires lifelogStore');
    }

    this.#todoistApi = todoistApi;
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
        throw new Error('Todoist API key not found');
      }

      // Initialize API if factory provided
      const api = typeof this.#todoistApi === 'function'
        ? this.#todoistApi(apiKey)
        : this.#todoistApi;

      // === CURRENT DATA: Open tasks ===
      let currentCount = 0;
      if (api) {
        const tasks = await api.getTasks();
        const currentTasks = tasks.map(task => ({
          id: task.id,
          content: task.content,
          description: task.description,
          priority: task.priority,
          dueDate: task.due?.date || null,
          dueString: task.due?.string || null,
          projectId: task.projectId,
          labels: task.labels,
          url: task.url,
        }));

        if (this.#currentStore) {
          await this.#currentStore.save(username, 'todoist', {
            lastUpdated: new Date().toISOString(),
            taskCount: currentTasks.length,
            tasks: currentTasks,
          });
        }
        currentCount = currentTasks.length;
      }

      // === LIFELOG DATA: Created and completed tasks ===
      const lifelogTasks = [];
      const cutoffDate = moment().subtract(daysBack, 'days');

      if (this.#httpClient) {
        // Fetch completed tasks
        try {
          const completedResponse = await this.#httpClient.post(
            'https://api.todoist.com/sync/v9/activity/get',
            { event_type: 'item:completed', limit: 100 },
            { headers: { Authorization: `Bearer ${apiKey}` } }
          );

          const completedTasks = (completedResponse.data?.events || [])
            .filter(event => moment(event.event_date).isAfter(cutoffDate))
            .map(event => ({
              id: event.object_id,
              content: event.extra_data?.content || 'Unknown task',
              time: moment(event.event_date).tz(this.#timezone).format('HH:mm'),
              date: moment(event.event_date).tz(this.#timezone).format('YYYY-MM-DD'),
              projectId: event.parent_project_id,
              action: 'completed',
            }));

          lifelogTasks.push(...completedTasks);
        } catch (error) {
          this.#logger.warn?.('todoist.activity.completed.error', {
            username,
            error: error.message,
          });
        }

        // Fetch created tasks
        try {
          const createdResponse = await this.#httpClient.post(
            'https://api.todoist.com/sync/v9/activity/get',
            { event_type: 'item:added', limit: 100 },
            { headers: { Authorization: `Bearer ${apiKey}` } }
          );

          const createdTasks = (createdResponse.data?.events || [])
            .filter(event => moment(event.event_date).isAfter(cutoffDate))
            .map(event => ({
              id: event.object_id,
              content: event.extra_data?.content || 'Unknown task',
              time: moment(event.event_date).tz(this.#timezone).format('HH:mm'),
              date: moment(event.event_date).tz(this.#timezone).format('YYYY-MM-DD'),
              projectId: event.parent_project_id,
              action: 'created',
            }));

          lifelogTasks.push(...createdTasks);
        } catch (error) {
          this.#logger.warn?.('todoist.activity.created.error', {
            username,
            error: error.message,
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

      return {
        current: currentCount,
        lifelog: { created: createdCount, completed: completedCount },
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429 || statusCode === 401) {
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
   * Merge tasks by date with composite key deduplication
   * @private
   */
  #mergeTasksByDate(existing, newTasks) {
    const merged = { ...existing };

    for (const task of newTasks) {
      if (!task.date) continue;

      if (!merged[task.date]) {
        merged[task.date] = [];
      }

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
