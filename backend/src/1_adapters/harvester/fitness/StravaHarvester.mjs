/**
 * StravaHarvester
 *
 * Fetches activity data from Strava API and saves to lifelog YAML.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - OAuth token refresh
 * - Paginated activity fetching
 * - Heart rate stream fetching with rate limiting
 * - Activity archiving (full data)
 * - Summary generation (lightweight)
 *
 * @module harvester/fitness/StravaHarvester
 */

import path from 'path';
import moment from 'moment-timezone';
import crypto from 'crypto';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { listYamlFiles, ensureDir, loadYamlSafe, saveYaml, deleteFile } from '#system/utils/FileIO.mjs';

const md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

/**
 * Strava activity harvester
 * @implements {IHarvester}
 */
export class StravaHarvester extends IHarvester {
  #stravaClient;
  #lifelogStore;
  #authStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;
  #rateLimitDelayMs;
  #fitnessHistoryDir;

  /**
   * @param {Object} config
   * @param {Object} config.stravaClient - Strava API client { refreshToken, getActivities, getActivityStreams }
   * @param {Object} config.lifelogStore - Store for reading/writing lifelog YAML
   * @param {Object} config.authStore - Store for reading/writing auth tokens
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {number} [config.rateLimitDelayMs=5000] - Delay between stream fetches
   * @param {string|null} [config.fitnessHistoryDir=null] - Path to fitness history YAML directory
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    stravaClient,
    lifelogStore,
    authStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    rateLimitDelayMs = 5000,
    fitnessHistoryDir = null,
    logger = console,
  }) {
    super();

    if (!stravaClient) {
      throw new InfrastructureError('StravaHarvester requires stravaClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'stravaClient'
      });
    }
    if (!lifelogStore) {
      throw new InfrastructureError('StravaHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#stravaClient = stravaClient;
    this.#lifelogStore = lifelogStore;
    this.#authStore = authStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#rateLimitDelayMs = rateLimitDelayMs;
    this.#logger = logger;
    this.#fitnessHistoryDir = fitnessHistoryDir;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'strava';
  }

  get category() {
    return HarvesterCategory.FITNESS;
  }

  /**
   * Harvest activities from Strava
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.daysBack=90] - Days of history to fetch
   * @param {string} [options.backfillSince] - Override start date (YYYY-MM-DD)
   * @returns {Promise<{ count: number, status: string, dateCount?: number }>}
   */
  async harvest(username, options = {}) {
    const { daysBack = 90, backfillSince } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('strava.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      // Calculate effective days back
      let effectiveDaysBack = daysBack;
      if (backfillSince) {
        const bfMoment = moment(backfillSince, 'YYYY-MM-DD', true);
        if (bfMoment.isValid()) {
          const diffDays = Math.max(1, moment().startOf('day').diff(bfMoment.startOf('day'), 'days') + 1);
          effectiveDaysBack = Math.max(effectiveDaysBack, diffDays);
          this.#logger.info?.('strava.harvest.backfill', { username, since: backfillSince, daysBack: effectiveDaysBack });
        }
      }

      this.#logger.info?.('strava.harvest.start', { username, daysBack: effectiveDaysBack });

      // 1. Refresh access token
      const tokenValid = await this.#refreshAccessToken(username);
      if (!tokenValid) {
        return { count: 0, status: 'error', reason: 'auth_failed' };
      }

      // 2. Fetch activities
      const activities = await this.#fetchActivities(username, effectiveDaysBack);
      if (!activities || activities.length === 0) {
        this.#circuitBreaker.recordSuccess();
        return { count: 0, status: 'success', dateCount: 0 };
      }

      // 3. Enrich with heart rate data
      const enrichedActivities = await this.#enrichWithHeartRate(username, activities);

      // 4. Save to archives (full data)
      await this.#saveToArchives(username, enrichedActivities);

      // 5. Generate and save summary
      const summary = await this.#generateAndSaveSummary(username, enrichedActivities);

      // 6. Age out old files from lifelog/strava/ to media/archives/strava/
      await this.#ageOutOldFiles(username);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      const dateCount = Object.keys(summary).length;
      // Get latest date from summary keys (sorted descending)
      const latestDate = Object.keys(summary).sort().reverse()[0] || null;

      this.#logger.info?.('strava.harvest.complete', {
        username,
        activityCount: enrichedActivities.length,
        dateCount,
        latestDate,
      });

      return { count: enrichedActivities.length, status: 'success', dateCount, latestDate };

    } catch (error) {
      const statusCode = error.response?.status;

      // Record failure for rate limit (429) or auth errors (401)
      if (statusCode === 429 || statusCode === 401) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('strava.harvest.error', {
        username,
        error: this.#cleanErrorMessage(error),
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
      { name: 'daysBack', type: 'number', default: 90, description: 'Days of history to fetch' },
      { name: 'backfillSince', type: 'string', default: null, description: 'Override start date (YYYY-MM-DD)' },
    ];
  }

  /**
   * Check if harvester is in cooldown state
   * @returns {boolean} True if circuit breaker is open
   */
  isInCooldown() {
    return this.#circuitBreaker.isOpen();
  }

  /**
   * Public wrapper for token refresh
   * @param {string} username - Target user
   * @returns {Promise<boolean>} True if token refresh succeeded
   */
  async refreshAccessToken(username) {
    return this.#refreshAccessToken(username);
  }

  /**
   * Public wrapper for fetching raw activities
   * @param {string} username - Target user
   * @param {number} [daysBack=90] - Days of history to fetch
   * @returns {Promise<Array>} Raw activity data from Strava
   */
  async fetchActivities(username, daysBack = 90) {
    return this.#fetchActivities(username, daysBack);
  }

  /**
   * Generate reauthorization URL for OAuth flow
   * Migrated from: strava.mjs:159-165
   * @param {Object} [options] - Options
   * @param {string} [options.redirectUri] - OAuth callback URL
   * @returns {Object} Object with authorization URL
   */
  reauthSequence(options = {}) {
    const clientId = this.#configService?.getSecret?.('STRAVA_CLIENT_ID');
    const defaultRedirectUri = this.#configService?.getSecret?.('STRAVA_URL') ||
                               'http://localhost:3000/api/auth/strava/callback';
    const redirectUri = options.redirectUri || defaultRedirectUri;

    const url = `https://www.strava.com/oauth/authorize?` +
      `client_id=${clientId}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `approval_prompt=force&` +
      `scope=read,activity:read_all`;

    return { url };
  }

  /**
   * Refresh OAuth access token
   * @private
   */
  async #refreshAccessToken(username) {
    try {
      // Read from disk (authStore) to get latest refresh token,
      // NOT configService which caches at boot and never reloads.
      const authData = (await this.#authStore?.load?.(username, 'strava'))
        || this.#configService?.getUserAuth?.('strava', username)
        || {};
      const refreshToken = authData.refresh;

      if (!refreshToken) {
        this.#logger.error?.('strava.auth.noRefreshToken', { username });
        return false;
      }

      const tokenData = await this.#stravaClient.refreshToken(refreshToken);

      if (tokenData && this.#authStore) {
        const newAuthData = {
          ...authData,
          refresh: tokenData.refresh_token || refreshToken,
          access_token: tokenData.access_token,
          expires_at: tokenData.expires_at,
        };
        await this.#authStore.save(username, 'strava', newAuthData);
      }

      return true;
    } catch (error) {
      this.#logger.error?.('strava.auth.error', {
        username,
        error: this.#cleanErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Fetch activities with pagination
   * @private
   */
  async #fetchActivities(username, daysBack) {
    const activities = [];
    let page = 1;
    const perPage = 100;
    const after = moment().subtract(daysBack, 'days').startOf('day').unix();
    const before = moment().endOf('day').unix();

    while (true) {
      const response = await this.#stravaClient.getActivities({ before, after, page, perPage });

      if (!response || response.length === 0) break;

      activities.push(...response);

      if (response.length < perPage) break;
      page++;
    }

    return activities;
  }

  /**
   * Enrich activities with heart rate stream data
   * @private
   */
  async #enrichWithHeartRate(username, activities) {
    const enriched = [];

    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      // Virtual activities don't have real HR data
      if (activity.type === 'VirtualRide' || activity.type === 'VirtualRun') {
        activity.heartRateOverTime = [9];
        enriched.push(activity);
        continue;
      }

      // Check archive for existing HR data (try recent strava/, then media archive, then legacy)
      const archiveName = `${date}_${safeType}_${activity.id}`;
      let archived = await this.#lifelogStore.load(username, `strava/${archiveName}`);
      if (!archived) {
        const mediaPath = path.join(this.#getMediaArchiveDir(), archiveName);
        archived = loadYamlSafe(mediaPath);
      }
      if (!archived) {
        archived = await this.#lifelogStore.load(username, `archives/strava/${archiveName}`);
      }
      if (archived?.data?.heartRateOverTime) {
        enriched.push(archived.data);
        continue;
      }

      // Fetch HR stream with rate limiting
      try {
        await this.#delay(this.#rateLimitDelayMs);

        const hrStream = await this.#stravaClient.getActivityStreams(activity.id, ['heartrate']);
        if (hrStream?.heartrate?.data) {
          activity.heartRateOverTime = hrStream.heartrate.data;
        } else {
          activity.heartRateOverTime = [0];
        }
      } catch (error) {
        this.#logger.warn?.('strava.heartrate.error', {
          activityId: activity.id,
          error: this.#cleanErrorMessage(error),
        });
        activity.heartRateOverTime = [1];

        // Re-throw rate limit errors
        if (error.response?.status === 429) {
          throw error;
        }
      }

      enriched.push(activity);
    }

    return enriched;
  }

  /**
   * Save full activity data to archives
   * @private
   */
  async #saveToArchives(username, activities) {
    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      const archiveData = {
        id: activity.id,
        date,
        type: safeType,
        src: 'strava',
        data: activity,
      };

      const archiveName = `${date}_${safeType}_${activity.id}`;
      await this.#lifelogStore.save(username, `strava/${archiveName}`, archiveData);
    }
  }

  /**
   * Generate summary and save to lifelog
   * @private
   */
  async #generateAndSaveSummary(username, activities) {
    // Load existing summary
    const existingSummary = await this.#lifelogStore.load(username, 'strava') || {};

    // Clean up legacy data
    const cleanedSummary = this.#cleanLegacyData(existingSummary);

    // Add new activities
    for (const activity of activities) {
      if (!activity?.id) continue;

      const date = moment(activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = activity.type || activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';

      if (!cleanedSummary[date]) {
        cleanedSummary[date] = [];
      }

      const summaryObj = this.#createSummaryObject(activity, safeType);

      // Update or add
      const existingIndex = cleanedSummary[date].findIndex((a) => a.id === summaryObj.id);
      if (existingIndex >= 0) {
        cleanedSummary[date][existingIndex] = summaryObj;
      } else {
        cleanedSummary[date].push(summaryObj);
      }
    }

    // Sort by date (newest first)
    const sortedSummary = this.#sortByDate(cleanedSummary);

    // Save
    await this.#lifelogStore.save(username, 'strava', sortedSummary);

    return sortedSummary;
  }

  /**
   * Create lightweight summary object
   * @private
   */
  #createSummaryObject(activity, type) {
    const obj = {
      id: activity.id,
    };

    if (activity.name) obj.title = activity.name;
    obj.type = type;
    if (activity.start_date) {
      obj.startTime = moment(activity.start_date).tz(this.#timezone).format('hh:mm a');
    }
    if (activity.distance) obj.distance = parseFloat(activity.distance.toFixed(2));
    if (activity.moving_time) obj.minutes = parseFloat((activity.moving_time / 60).toFixed(2));
    if (activity.calories || activity.kilojoules) {
      obj.calories = activity.calories || activity.kilojoules;
    }
    if (activity.average_heartrate) {
      obj.avgHeartrate = parseFloat(activity.average_heartrate.toFixed(2));
    }
    if (activity.max_heartrate) {
      obj.maxHeartrate = parseFloat(activity.max_heartrate.toFixed(2));
    }
    if (activity.suffer_score) {
      obj.suffer_score = parseFloat(activity.suffer_score.toFixed(2));
    }
    if (activity.device_name) obj.device_name = activity.device_name;

    return obj;
  }

  /**
   * Clean legacy data from summary
   * @private
   */
  #cleanLegacyData(summary) {
    const cleaned = { ...summary };

    Object.keys(cleaned).forEach((date) => {
      if (Array.isArray(cleaned[date])) {
        cleaned[date] = cleaned[date].filter((a) => a.id && !a.heartRateOverTime);
        if (cleaned[date].length === 0) {
          delete cleaned[date];
        }
      }
    });

    return cleaned;
  }

  /**
   * Sort summary by date (newest first)
   * @private
   */
  #sortByDate(summary) {
    const sortedDates = Object.keys(summary).sort((a, b) => new Date(b) - new Date(a));
    const sorted = {};

    sortedDates.forEach((date) => {
      if (summary[date].length > 0) {
        sorted[date] = summary[date];
      }
    });

    return sorted;
  }

  /**
   * Get media archive directory for strava
   * @private
   */
  #getMediaArchiveDir() {
    const mediaDir = this.#configService?.getMediaDir?.() || './media';
    return path.join(mediaDir, 'archives', 'strava');
  }

  /**
   * Get user's lifelog/strava directory
   * @private
   */
  #getUserStravaDir(username) {
    const userDir = this.#configService?.getUserDir?.(username) || `./data/users/${username}`;
    return path.join(userDir, 'lifelog', 'strava');
  }

  /**
   * Move files older than 90 days from lifelog/strava/ to media/archives/strava/
   * Also cleans up legacy 2-part filenames (DATE_ID.yml → old format).
   * Uses copy+delete for cross-mount safety.
   * @private
   */
  async #ageOutOldFiles(username) {
    const stravaDir = this.#getUserStravaDir(username);
    const mediaArchiveDir = this.#getMediaArchiveDir();
    const cutoff = moment().subtract(90, 'days').startOf('day');

    const files = listYamlFiles(stravaDir);
    if (files.length === 0) return;

    ensureDir(mediaArchiveDir);
    let movedCount = 0;

    for (const filename of files) {
      // Parse date from filename (first 10 chars: YYYY-MM-DD)
      const dateStr = filename.substring(0, 10);
      const fileDate = moment(dateStr, 'YYYY-MM-DD', true);
      if (!fileDate.isValid()) continue;

      // Check for legacy 2-part filenames (DATE_ID.yml — old format without type)
      const parts = filename.split('_');
      const isLegacyFormat = parts.length === 2;

      if (fileDate.isBefore(cutoff) || isLegacyFormat) {
        // Copy to media archive, then delete source
        const srcPath = path.join(stravaDir, `${filename}.yml`);
        const data = loadYamlSafe(srcPath);
        if (data) {
          saveYaml(path.join(mediaArchiveDir, filename), data);
          deleteFile(srcPath);
          movedCount++;
        }
      }
    }

    if (movedCount > 0) {
      this.#logger.info?.('strava.ageOut.complete', { username, movedCount });
    }
  }

  /**
   * Load home fitness sessions for a date range
   * @private
   * @param {string[]} dates - Array of YYYY-MM-DD date strings
   * @returns {Array<Object>} Session objects with parsed start/end times
   */
  #loadHomeSessions(dates) {
    if (!this.#fitnessHistoryDir) return [];

    const sessions = [];

    for (const date of dates) {
      const dateDir = path.join(this.#fitnessHistoryDir, date);
      const files = listYamlFiles(dateDir);

      for (const filename of files) {
        const filePath = path.join(dateDir, `${filename}.yml`);
        const data = loadYamlSafe(filePath);
        if (!data?.session?.start || !data?.participants) continue;

        sessions.push({
          sessionId: data.sessionId || data.session?.id,
          start: moment.tz(data.session.start, data.timezone || this.#timezone),
          end: data.session.end
            ? moment.tz(data.session.end, data.timezone || this.#timezone)
            : moment.tz(data.session.start, data.timezone || this.#timezone)
                .add(data.session.duration_seconds || 0, 'seconds'),
          participants: Object.keys(data.participants || {}),
          coins: data.treasureBox?.totalCoins ?? 0,
          media: (data.timeline?.events || [])
            .filter(e => e.type === 'media')
            .map(e => e.data?.title)
            .filter(Boolean)
            .join(', ') || null,
          filePath,
        });
      }
    }

    return sessions;
  }

  /**
   * Match Strava activities to home fitness sessions by time overlap
   * @private
   * @param {string} username - DaylightStation username
   * @param {Array} activities - Strava activity objects
   * @returns {Array<{ activityId, sessionId, session, activity }>} Matched pairs
   */
  #findMatches(username, activities) {
    const BUFFER_MS = 5 * 60 * 1000; // 5 minutes

    // Collect unique dates from activities
    const dates = [...new Set(activities.map(a =>
      moment(a.start_date).tz(this.#timezone).format('YYYY-MM-DD')
    ))];

    const homeSessions = this.#loadHomeSessions(dates);
    if (homeSessions.length === 0) return [];

    const matches = [];

    for (const activity of activities) {
      if (!activity?.id || !activity?.start_date) continue;

      const actStart = moment(activity.start_date).tz(this.#timezone);
      const actEnd = actStart.clone().add(activity.moving_time || 0, 'seconds');

      // Expand window by buffer
      const actStartBuffered = actStart.clone().subtract(BUFFER_MS, 'ms');
      const actEndBuffered = actEnd.clone().add(BUFFER_MS, 'ms');

      let bestMatch = null;
      let bestOverlap = 0;

      for (const session of homeSessions) {
        // Check participant
        if (!session.participants.includes(username)) continue;

        // Check time overlap with buffer
        const overlapStart = moment.max(actStartBuffered, session.start);
        const overlapEnd = moment.min(actEndBuffered, session.end);
        const overlapMs = overlapEnd.diff(overlapStart);

        if (overlapMs > 0 && overlapMs > bestOverlap) {
          bestOverlap = overlapMs;
          bestMatch = session;
        }
      }

      if (bestMatch) {
        matches.push({
          activityId: activity.id,
          sessionId: bestMatch.sessionId,
          session: bestMatch,
          activity,
        });
      }
    }

    return matches;
  }

  /**
   * Public wrapper for matching (used by tests and potential CLI)
   * @param {string} username
   * @param {Array} activities
   * @returns {Promise<Array>}
   */
  async matchHomeSessions(username, activities) {
    return this.#findMatches(username, activities);
  }

  /**
   * Apply enrichment from matches to both Strava and home session data
   * @private
   * @param {string} username
   * @param {Array} matches - Output from #findMatches
   */
  async #applyEnrichment(username, matches) {
    if (matches.length === 0) return;

    // 1. Enrich Strava summary
    const summary = await this.#lifelogStore.load(username, 'strava') || {};
    for (const match of matches) {
      const date = moment(match.activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const entries = summary[date];
      if (!entries) continue;

      const entry = entries.find(e => e.id === match.activityId);
      if (entry) {
        entry.homeSessionId = match.sessionId;
        entry.homeCoins = match.session.coins;
        if (match.session.media) entry.homeMedia = match.session.media;
      }
    }
    await this.#lifelogStore.save(username, 'strava', summary);

    // 2. Enrich Strava archive files
    for (const match of matches) {
      const date = moment(match.activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
      const typeRaw = match.activity.type || match.activity.sport_type || 'activity';
      const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';
      const archiveName = `strava/${date}_${safeType}_${match.activityId}`;

      const archive = await this.#lifelogStore.load(username, archiveName);
      if (archive?.data) {
        archive.data.homeSessionId = match.sessionId;
        archive.data.homeCoins = match.session.coins;
        if (match.session.media) archive.data.homeMedia = match.session.media;
        await this.#lifelogStore.save(username, archiveName, archive);
      }
    }

    // 3. Enrich home session files
    for (const match of matches) {
      const data = loadYamlSafe(match.session.filePath);
      if (!data?.participants) continue;

      if (data.participants[username]) {
        data.participants[username].strava = {
          activityId: match.activityId,
          type: match.activity.type || match.activity.sport_type || null,
          sufferScore: match.activity.suffer_score || null,
          deviceName: match.activity.device_name || null,
        };

        const savePath = match.session.filePath.replace(/\.yml$/, '');
        saveYaml(savePath, data);
      }
    }

    this.#logger.info?.('strava.homeMatch.complete', {
      username,
      matchCount: matches.length,
      sessionIds: matches.map(m => m.sessionId),
    });
  }

  /**
   * Public wrapper: find matches and apply enrichment
   * @param {string} username
   * @param {Array} activities
   */
  async applyHomeSessionEnrichment(username, activities) {
    const matches = this.#findMatches(username, activities);
    await this.#applyEnrichment(username, matches);
    return matches;
  }

  /**
   * Delay helper for rate limiting
   * @private
   */
  #delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract clean error message from HTML error responses
   * @private
   */
  #cleanErrorMessage(error) {
    const errorStr = error?.message || String(error);

    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html')) {
      const codeMatch = errorStr.match(/ERROR:\s*\((\d+)\),\s*([^,"]+)/);
      if (codeMatch) {
        const [, code, type] = codeMatch;
        return `HTTP ${code} ${type}`;
      }
    }

    return errorStr.length > 200 ? errorStr.substring(0, 200) + '...' : errorStr;
  }
}

export default StravaHarvester;
