/**
 * ClickUpHarvester
 *
 * Fetches task data from ClickUp API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Open tasks fetched by status (current data)
 * - Created/completed tasks by date (lifelog data)
 * - Space/project/list taxonomy mapping
 * - Paginated task fetching
 *
 * @module harvester/productivity/ClickUpHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '../../../0_infrastructure/config/index.mjs';

/**
 * ClickUp task harvester
 * @implements {IHarvester}
 */
export class ClickUpHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #currentStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} [config.currentStore] - Store for current data YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    lifelogStore,
    currentStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('ClickUpHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('ClickUpHarvester requires lifelogStore');
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
    return 'clickup';
  }

  get category() {
    return HarvesterCategory.PRODUCTIVITY;
  }

  /**
   * Harvest tasks from ClickUp
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=7] - Days of history to fetch for lifelog
   * @param {Array<string>} [options.statuses] - Statuses to fetch for current tasks
   * @param {Array<string>} [options.doneStatuses] - Statuses considered "done"
   * @returns {Promise<{ current: number, lifelog: { created: number, completed: number }, status: string }>}
   */
  async harvest(username, options = {}) {
    const clickupConfig = configService?.isReady?.() ? configService.getAdapterConfig('clickup') : null;
    const {
      daysBack = 7,
      statuses = clickupConfig?.statuses || [],
      doneStatuses = clickupConfig?.done_statuses || ['done', 'complete', 'closed'],
    } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('clickup.harvest.skipped', {
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
      this.#logger.info?.('clickup.harvest.start', { username, daysBack });

      // Get auth
      const auth = this.#configService?.getHouseholdAuth?.('clickup') ||
                   this.#configService?.getUserAuth?.('clickup', username) || {};
      const apiKey = auth.api_key || configService.getSecret('CLICKUP_PK');
      const teamId = auth.workspace_id || clickupConfig?.team_id;

      if (!apiKey) {
        throw new Error('ClickUp API key not found');
      }
      if (!teamId) {
        throw new Error('ClickUp team ID not found');
      }

      const headers = { Authorization: apiKey };

      // Fetch spaces for taxonomy mapping
      const spacesDict = await this.#fetchSpaces(teamId, headers);

      // === CURRENT DATA: In-progress tasks ===
      const tickets = await this.#fetchTasksByStatus(teamId, statuses, headers);
      const processedTickets = this.#processTickets(tickets, spacesDict);

      if (this.#currentStore) {
        await this.#currentStore.save(username, 'clickup', {
          lastUpdated: new Date().toISOString(),
          taskCount: processedTickets.length,
          tasks: processedTickets,
        });
      }

      // === LIFELOG DATA: Created and completed tasks ===
      const cutoffDate = moment().subtract(daysBack, 'days');
      const lifelogTasks = [];

      // Created tasks from current tickets
      const createdTasks = processedTickets
        .filter(t => t.date_created && moment(parseInt(t.date_created)).isAfter(cutoffDate))
        .map(t => ({
          id: t.id,
          name: t.name,
          time: moment(parseInt(t.date_created)).tz(this.#timezone).format('HH:mm'),
          date: moment(parseInt(t.date_created)).tz(this.#timezone).format('YYYY-MM-DD'),
          status: t.status,
          taxonomy: t.taxonomy,
          action: 'created',
        }));
      lifelogTasks.push(...createdTasks);

      // Fetch completed tasks
      try {
        const doneTasks = await this.#fetchTasksByStatus(teamId, doneStatuses, headers);
        const completedTasks = doneTasks
          .filter(t => {
            const doneDate = t.date_done || t.date_updated;
            return doneDate && moment(parseInt(doneDate)).isAfter(cutoffDate);
          })
          .map(t => {
            const doneDate = t.date_done || t.date_updated;
            return {
              id: t.id,
              name: t.name,
              time: moment(parseInt(doneDate)).tz(this.#timezone).format('HH:mm'),
              date: moment(parseInt(doneDate)).tz(this.#timezone).format('YYYY-MM-DD'),
              taxonomy: this.#buildTaxonomy(t, spacesDict),
              action: 'completed',
            };
          });
        lifelogTasks.push(...completedTasks);
      } catch (error) {
        this.#logger.warn?.('clickup.completed.error', {
          username,
          error: error.message,
        });
      }

      // Merge into existing lifelog
      const existingLifelog = await this.#lifelogStore.load(username, 'clickup') || {};
      const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
      const updatedLifelog = this.#mergeTasksByDate(existingDateKeyed, lifelogTasks);

      // Sort by date (newest first)
      const sortedLifelog = this.#sortByDate(updatedLifelog);
      await this.#lifelogStore.save(username, 'clickup', sortedLifelog);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const createdCount = lifelogTasks.filter(t => t.action === 'created').length;
      const completedCount = lifelogTasks.filter(t => t.action === 'completed').length;

      this.#logger.info?.('clickup.harvest.complete', {
        username,
        current: processedTickets.length,
        lifelog: { created: createdCount, completed: completedCount },
      });

      return {
        current: processedTickets.length,
        lifelog: { created: createdCount, completed: completedCount },
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 429 || statusCode === 401) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('clickup.harvest.error', {
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
   * Fetch spaces and build ID->name mapping
   * @private
   */
  async #fetchSpaces(teamId, headers) {
    const response = await this.#httpClient.get(
      `https://api.clickup.com/api/v2/team/${teamId}/space`,
      { headers }
    );

    const spaces = response.data?.spaces || [];
    return spaces.reduce((acc, space) => {
      acc[space.id] = space.name;
      return acc;
    }, {});
  }

  /**
   * Fetch tasks by status with pagination
   * @private
   */
  async #fetchTasksByStatus(teamId, statuses, headers) {
    const params = { subtasks: true };
    statuses.forEach((status, index) => {
      params[`statuses[${index}]`] = status;
    });

    const tickets = [];
    let page = 0;
    let lastPage = false;

    while (!lastPage) {
      const url = `https://api.clickup.com/api/v2/team/${teamId}/task?${new URLSearchParams({ ...params, page })}`;
      const response = await this.#httpClient.get(url, { headers });

      tickets.push(...(response.data?.tasks || []));
      lastPage = response.data?.last_page ?? true;
      page++;

      // Safety limit
      if (page > 10) break;
    }

    return tickets;
  }

  /**
   * Process raw tickets into structured format
   * @private
   */
  #processTickets(tickets, spacesDict) {
    return tickets.map(ticket => ({
      id: ticket.id,
      name: ticket.name,
      status: ticket.status?.status,
      date_created: ticket.date_created,
      taxonomy: this.#buildTaxonomy(ticket, spacesDict),
    }));
  }

  /**
   * Build taxonomy object for a ticket
   * @private
   */
  #buildTaxonomy(ticket, spacesDict) {
    const taxonomy = {};

    if (ticket.space?.id && spacesDict[ticket.space.id]) {
      taxonomy[ticket.space.id] = spacesDict[ticket.space.id];
    }
    if (ticket.project?.id && ticket.project?.name) {
      taxonomy[ticket.project.id] = ticket.project.name;
    }
    if (ticket.list?.id && ticket.list?.name) {
      taxonomy[ticket.list.id] = ticket.list.name;
    }

    // Remove hidden or empty values
    return Object.fromEntries(
      Object.entries(taxonomy).filter(([_, val]) => val && val !== 'hidden')
    );
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

export default ClickUpHarvester;
