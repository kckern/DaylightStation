/** Read-only ClickUp task collection. Source workflow and coverage stay explicit. */
import moment from 'moment-timezone';
import {createLogger} from '#system/logging/logger.mjs';
import { IHarvester, HarvesterCategory } from '#apps/harvester/ports/IHarvester.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { providerId, sourceInstant, historyRange, snapshotScope, activity, mergeTaskHistory, incompleteResult, observationError } from './taskObservations.mjs';
export class ClickUpHarvester extends IHarvester {
  static API_BASE = 'https://api.clickup.com/api/v2';
  #http;
  #lifelog;
  #current;
  #auth;
  #householdAuth;
  #config;
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
    getHouseholdAuth,
    adapterConfig,
    apiKey,
    timezone = 'America/Los_Angeles',
    logger = createLogger({source:'backend',app:'harvest',context:{module:'clickup'}}),
    clock = Date.now,
    workScopeForUser
  } = {}) {
    super();
    if (!httpClient) throw new InfrastructureError('ClickUpHarvester requires httpClient', {
      code: 'MISSING_DEPENDENCY',
      dependency: 'httpClient'
    });
    if (!lifelogStore) throw new InfrastructureError('ClickUpHarvester requires lifelogStore', {
      code: 'MISSING_DEPENDENCY',
      dependency: 'lifelogStore'
    });
    this.#http = httpClient;
    this.#lifelog = lifelogStore;
    this.#current = currentStore;
    this.#auth = getUserAuth;
    this.#householdAuth = getHouseholdAuth;
    this.#config = adapterConfig;
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
    return 'clickup';
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
    }, {
      name: 'statuses',
      type: 'array',
      default: [],
      description: 'Open workflow statuses'
    }];
  }
  async #tasks({
    teamId,
    statuses,
    headers,
    budget,
    done = false
  }) {
    const tasks = [];
    for (let page = 0;; page++) {
      if (budget.remaining-- <= 0) throw observationError('WORK_PAGE_LIMIT');
      const params = {
        subtasks: true,
        include_closed: done,
        page
      };
      statuses.forEach((status, index) => {
        params[`statuses[${index}]`] = status;
      });
      const url = ClickUpHarvester.API_BASE + '/team/' + encodeURIComponent(teamId) + '/task?' + new URLSearchParams(params),
        response = await this.#http.get(url, {
          headers
        }),
        data = response?.data;
      if (!Array.isArray(data?.tasks)) throw observationError('INVALID_PROVIDER_PAGE');
      tasks.push(...data.tasks);
      if (data.last_page === true || data.last_page == null && data.tasks.length < 100) return tasks;
      if (data.last_page !== false && data.last_page != null) throw observationError('INVALID_PROVIDER_PAGE');
    }
  }
  #row(task, spaces) {
    const ancestors = [];
    if (task.space?.id) ancestors.push({
      id: providerId(task.space.id),
      nativeKind: 'space',
      name: spaces[task.space.id] ?? task.space.name ?? null
    });
    const folder = task.folder ?? task.project;
    if (folder?.id && folder.hidden !== true) ancestors.push({
      id: providerId(folder.id),
      nativeKind: 'folder',
      name: folder.name ?? null
    });
    const taxonomy = Object.fromEntries([...ancestors, ...(task.list?.id ? [{
      id: providerId(task.list.id),
      name: task.list.name
    }] : [])].filter(x => x.name && x.name !== 'hidden').map(x => [x.id, x.name]));
    return {
      ...task,
      id: providerId(task.id),
      name: task.name,
      status: task.status?.status ?? task.status ?? null,
      statusType: task.status?.type ?? null,
      date_created: task.date_created ?? null,
      createdAt: sourceInstant(task.date_created),
      modifiedAt: sourceInstant(task.date_updated),
      completedAt: sourceInstant(task.date_done),
      containerId: task.list?.id ? providerId(task.list.id) : null,
      containerType: 'list',
      ancestorRefs: ancestors,
      taxonomy,
      assigneeIds: (task.assignees ?? []).map(a => providerId(a.id))
    };
  }
  async harvest(username, options = {}) {
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
    const auth = this.#householdAuth?.('clickup') ?? this.#auth?.('clickup', username) ?? {},
      apiKey = auth.api_key ?? this.#apiKey,
      teamId = auth.workspace_id ?? this.#config?.team_id;
    if (!apiKey || !teamId) throw new InfrastructureError('ClickUp credentials/workspace not configured', {
      code: 'MISSING_CONFIG',
      service: 'ClickUp'
    });
    const range = historyRange(this.#clock, options.daysBack ?? 7),
      scope = snapshotScope(this.#scope?.(username, 'clickup'));
    try {
      const headers = {
          Authorization: apiKey
        },
        budget = {
          remaining: 100
        };
      const rawSpaces = (await this.#http.get(ClickUpHarvester.API_BASE + '/team/' + encodeURIComponent(teamId) + '/space', {
        headers
      }))?.data?.spaces;
      if (!Array.isArray(rawSpaces)) throw observationError('INVALID_PROVIDER_PAGE');
      const spaces = Object.fromEntries(rawSpaces.map(s => [providerId(s.id), s.name])),
        containers = [];
      for (const id of scope.containerIds ?? []) {
        const list = (await this.#http.get(ClickUpHarvester.API_BASE + '/list/' + encodeURIComponent(id), {
          headers
        }))?.data;
        if (!list || providerId(list.id) !== id || !Object.hasOwn(spaces, String(list.space?.id))) throw observationError('INVALID_PROVIDER_SCOPE');
        containers.push({
          ...list,
          id,
          nativeKind: 'list',
          parentId: list.folder?.id ? providerId(list.folder.id) : null
        });
      }
      const open = await this.#tasks({
        teamId,
        statuses: options.statuses ?? this.#config?.statuses ?? [],
        headers,
        budget
      });
      const done = await this.#tasks({
        teamId,
        statuses: options.doneStatuses ?? this.#config?.done_statuses ?? ['done', 'complete', 'closed'],
        headers,
        budget,
        done: true
      });
      const rows = open.map(task => this.#row(task, spaces)),
        events = [];
      for (const task of rows) if (task.createdAt !== null && task.createdAt >= range.from && task.createdAt < range.to) events.push(activity({
        id: task.id,
        title: task.name,
        at: task.createdAt,
        createdAt: task.createdAt,
        action: 'created',
        timezone: this.#timezone,
        projectId: task.containerId,
        actorId: task.creator?.id,
        extra: {
          status: task.status,
          taxonomy: task.taxonomy,
          accountId: scope.accountId,
          provider: 'clickup',
          assigneeIds: task.assigneeIds
        }
      }));
      for (const raw of done) {
        const task = this.#row(raw, spaces),
          at = task.completedAt ?? task.modifiedAt;
        if (at !== null && at >= range.from && at < range.to) events.push(activity({
          id: task.id,
          title: task.name,
          at,
          createdAt: task.createdAt,
          action: 'completed',
          timezone: this.#timezone,
          projectId: task.containerId,
          estimated: task.completedAt === null,
          extra: {
            taxonomy: task.taxonomy,
            accountId: scope.accountId,
            provider: 'clickup',
            assigneeIds: task.assigneeIds
          }
        }));
      }
      const history = mergeTaskHistory(await this.#lifelog.load(username, 'clickup'), events),
        coverage = {
          complete: true,
          scope,
          ...range,
          reason: null
        };
      const snapshot = {
        schema: 'work-source-snapshot/v1',
        provider: 'clickup',
        accountId: scope.accountId,
        observedAt: range.to,
        lastUpdated: moment.tz(range.to, this.#timezone).format('YYYY-MM-DD HH:mm:ss'),
        taskCount: rows.length,
        tasks: rows,
        containers,
        coverage
      };
      await this.#lifelog.save(username, 'clickup', history);
      await this.#current?.save(username, 'clickup', snapshot);
      this.#breaker.recordSuccess();
      this.#logger?.info?.('clickup.harvest.complete', {
        username,
        current: rows.length
      });
      return {
        status: 'success',
        current: rows.length,
        lifelog: {
          created: events.filter(e => e.action === 'created').length,
          completed: events.filter(e => e.action === 'completed').length
        },
        coverage,
        latestDate: Object.keys(history)[0] ?? null
      };
    } catch (error) {
      if ([401, 429].includes(error.response?.status)) this.#breaker.recordFailure(error);
      this.#logger?.warn?.('clickup.harvest.incomplete', {
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
export default ClickUpHarvester;
