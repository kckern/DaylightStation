/**
 * GitHubHarvester
 *
 * Fetches commit and activity data from GitHub API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Commit history from user's repos
 * - Event tracking (PRs, issues, comments, branch creation)
 * - Rate limit handling with optional token auth
 * - Deduplication by event ID
 *
 * @module harvester/productivity/GitHubHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';

/**
 * GitHub activity harvester
 * @implements {IHarvester}
 */
export class GitHubHarvester extends IHarvester {
  #httpClient;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    lifelogStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('GitHubHarvester requires httpClient');
    }
    if (!lifelogStore) {
      throw new Error('GitHubHarvester requires lifelogStore');
    }

    this.#httpClient = httpClient;
    this.#lifelogStore = lifelogStore;
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
    return 'github';
  }

  get category() {
    return HarvesterCategory.PRODUCTIVITY;
  }

  /**
   * Harvest activity from GitHub
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=90] - Days of commit history to fetch
   * @param {number} [options.maxRepos=10] - Max repos to fetch commits from
   * @returns {Promise<{ count: number, types: string[], status: string }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = 90, maxRepos = 10 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('github.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        types: [],
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('github.harvest.start', { username, daysBack, maxRepos });

      // Get auth
      const auth = this.#configService?.getUserAuth?.('github', username) || {};
      const githubUsername = auth.username;
      const githubToken = auth.token;

      if (!githubUsername) {
        throw new Error('GitHub username not configured');
      }

      const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'DaylightStation-Harvester',
      };

      if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
      }

      const activities = [];
      const sinceDate = moment().subtract(daysBack, 'days').toISOString();

      // Fetch user's repos
      const reposResponse = await this.#httpClient.get(
        `https://api.github.com/users/${githubUsername}/repos`,
        {
          headers,
          params: { per_page: 100, sort: 'pushed', direction: 'desc' },
        }
      );

      // Get commits from recent repos
      const recentRepos = (reposResponse.data || []).slice(0, maxRepos);

      for (const repo of recentRepos) {
        try {
          const commitsResponse = await this.#httpClient.get(
            `https://api.github.com/repos/${repo.full_name}/commits`,
            {
              headers,
              params: {
                author: githubUsername,
                per_page: 50,
                since: sinceDate,
              },
            }
          );

          for (const commit of (commitsResponse.data || [])) {
            activities.push({
              id: commit.sha,
              type: 'commit',
              repo: repo.full_name,
              sha: commit.sha.substring(0, 7),
              message: commit.commit.message.split('\n')[0],
              fullMessage: commit.commit.message,
              createdAt: commit.commit.author.date,
              date: moment(commit.commit.author.date).tz(this.#timezone).format('YYYY-MM-DD'),
              timestamp: moment(commit.commit.author.date).unix(),
              url: commit.html_url,
              additions: commit.stats?.additions,
              deletions: commit.stats?.deletions,
            });
          }
        } catch (repoError) {
          this.#logger.debug?.('github.repo.skip', {
            repo: repo.full_name,
            error: repoError.message,
          });
        }
      }

      // Fetch public events (PRs, issues, comments)
      const eventsResponse = await this.#httpClient.get(
        `https://api.github.com/users/${githubUsername}/events/public`,
        {
          headers,
          params: { per_page: 100 },
        }
      );

      for (const event of (eventsResponse.data || [])) {
        const baseEvent = {
          id: event.id,
          repo: event.repo.name,
          createdAt: event.created_at,
          date: moment(event.created_at).tz(this.#timezone).format('YYYY-MM-DD'),
          timestamp: moment(event.created_at).unix(),
        };

        switch (event.type) {
          case 'PullRequestEvent':
            activities.push({
              ...baseEvent,
              type: 'pull_request',
              action: event.payload.action,
              prNumber: event.payload.pull_request?.number,
              title: event.payload.pull_request?.title,
              url: event.payload.pull_request?.html_url,
            });
            break;

          case 'IssuesEvent':
            activities.push({
              ...baseEvent,
              type: 'issue',
              action: event.payload.action,
              issueNumber: event.payload.issue?.number,
              title: event.payload.issue?.title,
              url: event.payload.issue?.html_url,
            });
            break;

          case 'IssueCommentEvent':
            activities.push({
              ...baseEvent,
              type: 'comment',
              issueNumber: event.payload.issue?.number,
              body: event.payload.comment?.body?.substring(0, 200),
              url: event.payload.comment?.html_url,
            });
            break;

          case 'CreateEvent':
            if (event.payload.ref_type === 'repository' || event.payload.ref_type === 'branch') {
              activities.push({
                ...baseEvent,
                type: 'create',
                refType: event.payload.ref_type,
                ref: event.payload.ref,
              });
            }
            break;
        }
      }

      // Sort by timestamp and dedupe
      activities.sort((a, b) => b.timestamp - a.timestamp);

      const seen = new Set();
      const deduped = activities.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });

      // Save to lifelog
      await this.#lifelogStore.save(username, 'github', deduped);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const types = [...new Set(deduped.map(a => a.type))];

      this.#logger.info?.('github.harvest.complete', {
        username,
        githubUsername,
        activityCount: deduped.length,
        types,
      });

      return {
        count: deduped.length,
        types,
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 403) {
        // Rate limit
        this.#circuitBreaker.recordFailure(error);
        this.#logger.error?.('github.rate_limit', {
          username,
          message: 'GitHub API rate limit exceeded',
        });
      } else if (statusCode === 404) {
        this.#logger.error?.('github.user.not_found', {
          username,
        });
      } else {
        this.#logger.error?.('github.harvest.error', {
          username,
          error: error.message,
          statusCode,
          circuitState: this.#circuitBreaker.getStatus().state,
        });
      }

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
      { name: 'daysBack', type: 'number', default: 90, description: 'Days of commit history to fetch' },
      { name: 'maxRepos', type: 'number', default: 10, description: 'Max repos to fetch commits from' },
    ];
  }
}

export default GitHubHarvester;
