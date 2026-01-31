/**
 * GCalHarvester
 *
 * Fetches user's calendar events from Google Calendar API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Upcoming events fetching (next 6 weeks)
 * - Past events for lifelog (last 6 weeks)
 * - Date-keyed lifelog storage
 * - Multi-calendar support
 *
 * @module harvester/communication/GCalHarvester
 */

import { google } from 'googleapis';
import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Google Calendar event harvester
 * @implements {IHarvester}
 */
export class GCalHarvester extends IHarvester {
  #lifelogStore;
  #currentStore;
  #sharedStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.currentStore - Store for current calendar state
   * @param {Object} [config.sharedStore] - Store for household shared calendar
   * @param {Object} config.configService - ConfigService for credentials
   * @param {string} [config.timezone] - Timezone for date formatting
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    lifelogStore,
    currentStore,
    sharedStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!lifelogStore) {
      throw new InfrastructureError('GCalHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#lifelogStore = lifelogStore;
    this.#currentStore = currentStore;
    this.#sharedStore = sharedStore;
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
    return 'gcal';
  }

  get category() {
    return HarvesterCategory.COMMUNICATION;
  }

  /**
   * Harvest calendar events from Google Calendar
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.weeksAhead=6] - Weeks to look ahead
   * @param {number} [options.weeksBack=6] - Weeks to look back
   * @returns {Promise<{ upcoming: number, past: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { weeksAhead = 6, weeksBack = 6 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('gcal.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        upcoming: 0,
        past: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('gcal.harvest.start', { username, weeksAhead, weeksBack });

      // Create Calendar client
      const calendar = await this.#createCalendarClient(username);

      // Get date ranges
      const now = new Date();
      const pastStart = new Date();
      pastStart.setDate(now.getDate() - (weeksBack * 7));
      const futureEnd = new Date();
      futureEnd.setDate(now.getDate() + (weeksAhead * 7));

      // List available calendars
      const { data: list } = await calendar.calendarList.list();
      const selectedCalendars = list.items.filter(cal => cal.selected);

      // Fetch upcoming events (for current state)
      const upcomingEvents = await this.#fetchEvents(
        calendar,
        selectedCalendars,
        now,
        futureEnd,
        false // Don't include calendar name
      );

      // Fetch past events (for lifelog)
      const pastEvents = await this.#fetchEvents(
        calendar,
        selectedCalendars,
        pastStart,
        now,
        true // Include calendar name
      );

      // Sort upcoming by start time
      upcomingEvents.sort((a, b) => {
        const aTime = a.startDateTime || a.startDate;
        const bTime = b.startDateTime || b.startDate;
        return new Date(aTime) - new Date(bTime);
      });

      // Save upcoming to current store
      if (this.#currentStore) {
        await this.#currentStore.save(username, upcomingEvents);
      }

      // Save to shared household store if available
      if (this.#sharedStore) {
        await this.#sharedStore.save(upcomingEvents);
      }

      // Load existing lifelog and merge
      const existingLifelog = await this.#lifelogStore.load(username, 'calendar') || {};
      const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
      const updatedLifelog = this.#mergeEventsByDate(existingDateKeyed, pastEvents);

      // Save lifelog
      await this.#lifelogStore.save(username, 'calendar', updatedLifelog);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('gcal.harvest.complete', {
        username,
        upcoming: upcomingEvents.length,
        past: pastEvents.length,
        calendars: selectedCalendars.length,
      });

      return {
        upcoming: upcomingEvents.length,
        past: pastEvents.length,
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status || error.code;

      if (statusCode === 429 || statusCode === 401 || statusCode === 403) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('gcal.harvest.error', {
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
      { name: 'weeksAhead', type: 'number', default: 6, description: 'Weeks to look ahead for upcoming events' },
      { name: 'weeksBack', type: 'number', default: 6, description: 'Weeks to look back for past events' },
    ];
  }

  /**
   * Create authenticated Calendar client
   * @private
   */
  async #createCalendarClient(username) {
    const GOOGLE_CLIENT_ID = this.#configService?.getSecret?.('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = this.#configService?.getSecret?.('GOOGLE_CLIENT_SECRET');
    const GOOGLE_REDIRECT_URI = this.#configService?.getSecret?.('GOOGLE_REDIRECT_URI');
    const auth = this.#configService?.getUserAuth?.('google', username) || {};
    const refreshToken = auth.refresh_token || this.#configService?.getSecret?.('GOOGLE_REFRESH_TOKEN');

    if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
      throw new InfrastructureError('Google Calendar credentials not found', {
        code: 'MISSING_CONFIG',
        service: 'GoogleCalendar',
        required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'refresh_token']
      });
    }

    const oAuth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    return google.calendar({ version: 'v3', auth: oAuth2Client });
  }

  /**
   * Fetch events from multiple calendars
   * @private
   */
  async #fetchEvents(calendar, calendars, timeMin, timeMax, includeCalendarName) {
    const events = [];

    for (const cal of calendars) {
      const { data } = await calendar.events.list({
        calendarId: cal.id,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const calendarName = includeCalendarName ? (cal.summary || cal.id) : null;
      const formatted = data.items.map(event => this.#formatEvent(event, calendarName));
      events.push(...formatted);
    }

    return events;
  }

  /**
   * Format a calendar event
   * @private
   */
  #formatEvent(event, calendarName) {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const allday = !!(event.start?.date && !event.start?.dateTime);

    const formatted = {
      id: event.id,
      date: moment(start).format('YYYY-MM-DD'),
      time: allday ? null : moment(start).format('h:mm A'),
      endTime: allday ? null : moment(end).format('h:mm A'),
      summary: event.summary || 'Untitled Event',
      description: event.description || null,
      location: event.location || null,
      allday,
      duration: allday ? null : moment(end).diff(moment(start), 'hours', true),
    };

    // Include raw datetime for sorting
    formatted.startDateTime = start;
    formatted.startDate = formatted.date;

    if (calendarName) {
      formatted.calendarName = calendarName;
    }

    return formatted;
  }

  /**
   * Merge events by date into lifelog structure
   * @private
   */
  #mergeEventsByDate(existing, newEvents) {
    const merged = { ...existing };

    for (const event of newEvents) {
      if (!merged[event.date]) merged[event.date] = [];
      if (!merged[event.date].find(e => e.id === event.id)) {
        merged[event.date].push(event);
      }
    }

    // Sort each day's events by time
    for (const date of Object.keys(merged)) {
      merged[date].sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return -1; // All-day events first
        if (!b.time) return 1;
        return a.time.localeCompare(b.time);
      });
    }

    return merged;
  }
}

export default GCalHarvester;
