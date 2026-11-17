/** Read-only Todoist task/project collection with explicit bounded coverage. */
import moment from 'moment-timezone';
import {createLogger} from '#system/logging/logger.mjs';
import { IHarvester, HarvesterCategory } from '#apps/harvester/ports/IHarvester.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { providerId, sourceInstant, historyRange, cursorPages, snapshotScope, activity, mergeTaskHistory, incompleteResult } from './taskObservations.mjs';
export class TodoistHarvester extends IHarvester {
  static API_BASE = 'https://api.todoist.com/api/v1';
  #http;
  #lifelog;
  #current;
  #auth;
  #apiKey;
  #timezone;
  #logger;
  #clock;
  #scope;
  #breaker;
  constructor({
    httpClient,
    lifelogStore,
    currentStore,
    getUserAuth,
    apiKey,
    timezone = 'America/Los_Angeles',
    logger = createLogger({source:'backend',app:'harvest',context:{module:'todoist'}}),
    clock = Date.now,
    workScopeForUser
  } = {}) {
    super();
    if (!lifelogStore) throw new InfrastructureError('TodoistHarvester requires lifelogStore', {
      code: 'MISSING_DEPENDENCY',
      dependency: 'lifelogStore'
    });
    this.#http = httpClient;
    this.#lifelog = lifelogStore;
    this.#current = currentStore;
    this.#auth = getUserAuth;
    this.#apiKey = apiKey;
    this.#timezone = timezone;
    this.#logger = logger;
    this.#clock = clock;
    this.#scope = workScopeForUser;
    this.#breaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 300000,
      maxCooldownMs: 7200000,
      logger
    });
  }
  get serviceId() {
    return 'todoist';
  }
  get category() {
    return HarvesterCategory.PRODUCTIVITY;
  }
  getStatus() {
    return this.#breaker.getStatus();
  }
  getParams() {
    return [{
      name: 'daysBack',
      type: 'number',
      default: 7,
      description: 'Days of history to fetch for lifelog (maximum90)'
    }];
  }
  async harvest(username, {
    daysBack = 7
  } = {}) {
    if (this.#breaker.isOpen()) return {
      status: 'skipped',
      reason: 'cooldown',
      current: 0,
      lifelog: {
        created: 0,
        completed: 0
      },
      remainingMins: this.#breaker.getCooldownStatus()?.remainingMins
    };
    const apiKey = this.#auth?.('todoist', username)?.api_key ?? this.#apiKey;
    if (!apiKey) throw new InfrastructureError('Todoist API key not found', {
      code: 'MISSING_CONFIG',
      service: 'Todoist',
      field: 'api_key'
    });
    const range = historyRange(this.#clock, daysBack),
      scope = snapshotScope(this.#scope?.(username, 'todoist'));
    try {
      const headers = {
          Authorization: `Bearer ${apiKey}`
        },
        budget = {
          remaining: 100
        };
      const read = (suffix, field, params) => cursorPages({
        client: this.#http,
        url: TodoistHarvester.API_BASE + suffix,
        headers,
        budget,
        field,
        params
      });
      const tasks = await read('/tasks', 'results'),
        projects = await read('/projects', 'results'),
        completed = [];
      // Keep each completion query below the provider's three-calendar-month range ceiling.
      for (let from = range.from; from < range.to;) {
        const to = Math.min(from + 28 * 86400000, range.to);
        const rows = await read('/tasks/completed/by_completion_date', 'items', {
          since: new Date(from).toISOString(),
          until: new Date(to).toISOString()
        });
        completed.push(...rows.filter(row => {
          const at = sourceInstant(row.completed_at);
          return at !== null && at >= from && at < to;
        }));
        from = to;
      }
      const currentTasks = tasks.map(task => ({
        ...task,
        id: providerId(task.id),
        content: task.content,
        description: task.description ?? null,
        priority: task.priority ?? 1,
        dueDate: task.due?.date ?? null,
        dueString: task.due?.string ?? null,
        projectId: task.project_id == null ? null : providerId(task.project_id),
        labels: task.labels ?? [],
        createdAt: sourceInstant(task.added_at),
        modifiedAt: sourceInstant(task.updated_at),
        completedAt: sourceInstant(task.completed_at),
        containerId: task.project_id == null ? null : providerId(task.project_id),
        containerType: 'project',
        assigneeIds: task.responsible_uid == null ? [] : [providerId(task.responsible_uid)]
      }));
      const containers = projects.map(project => ({
        ...project,
        id: providerId(project.id),
        nativeKind: 'project',
        name: project.name,
        parentId: project.parent_id == null ? null : providerId(project.parent_id),
        createdAt: sourceInstant(project.added_at),
        modifiedAt: sourceInstant(project.updated_at)
      }));
      const newEvents = [];
      for (const task of currentTasks) if (task.createdAt !== null && task.createdAt >= range.from && task.createdAt < range.to) newEvents.push(activity({
        id: task.id,
        title: task.content,
        at: task.createdAt,
        createdAt: task.createdAt,
        action: 'created',
        timezone: this.#timezone,
        projectId: task.projectId,
        actorId: task.added_by_uid,
        extra: {
          accountId: scope.accountId,
          provider: 'todoist',
          assigneeIds: task.assigneeIds
        }
      }));
      for (const task of completed) newEvents.push(activity({
        id: task.task_id ?? task.id,
        title: task.content,
        at: sourceInstant(task.completed_at),
        createdAt: sourceInstant(task.added_at),
        action: 'completed',
        timezone: this.#timezone,
        projectId: task.project_id,
        actorId: task.completed_by_uid,
        extra: {
          due: task.due ?? null,
          accountId: scope.accountId,
          provider: 'todoist',
          assigneeIds: task.responsible_uid == null ? [] : [providerId(task.responsible_uid)]
        }
      }));
      const history = mergeTaskHistory(await this.#lifelog.load(username, 'todoist'), newEvents);
      const coverage = {
          complete: true,
          scope,
          ...range,
          reason: null
        },
        snapshot = {
          schema: 'work-source-snapshot/v1',
          provider: 'todoist',
          accountId: scope.accountId,
          observedAt: range.to,
          lastUpdated: moment.tz(range.to, this.#timezone).format('YYYY-MM-DD HH:mm:ss'),
          taskCount: currentTasks.length,
          tasks: currentTasks,
          containers,
          coverage
        };
      // Finish every read before touching either projection. Partial network data is never published.
      await this.#lifelog.save(username, 'todoist', history);
      await this.#current?.save(username, 'todoist', snapshot);
      this.#breaker.recordSuccess();
      this.#logger?.info?.('todoist.harvest.complete', {
        username,
        current: currentTasks.length
      });
      return {
        status: 'success',
        current: currentTasks.length,
        lifelog: {
          created: newEvents.filter(e => e.action === 'created').length,
          completed: newEvents.filter(e => e.action === 'completed').length
        },
        coverage,
        latestDate: Object.keys(history)[0] ?? null
      };
    } catch (error) {
      if ([401, 410, 429].includes(error.response?.status)) this.#breaker.recordFailure(error);
      this.#logger?.warn?.('todoist.harvest.incomplete', {
        username,
        code: error.code ?? 'provider_read_failed'
      });
      return incompleteResult({
        error,
        scope,
        range
      });
    }
  }
}
export default TodoistHarvester;
