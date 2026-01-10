import { google } from 'googleapis';
import { saveFile, sanitize, userSaveFile, userLoadFile, userSaveCurrent, getDefaultUsername } from './io.mjs';
import { configService } from './config/index.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';
import moment from 'moment';

const defaultGcalLogger = createLogger({
    source: 'backend',
    app: 'gcal'
});

/**
 * Format a calendar event into standardized structure
 * @param {Object} event - Raw Google Calendar event
 * @param {string} calendarName - Name of the calendar
 * @returns {Object} Formatted event
 */
const formatEvent = (event, calendarName) => {
    const start = event.start?.dateTime || event.start?.date;
    const end = event.end?.dateTime || event.end?.date;
    const allday = !!(event.start?.date && !event.start?.dateTime);
    
    return {
        id: event.id,
        date: moment(start).format('YYYY-MM-DD'),
        time: allday ? null : moment(start).format('h:mm A'),
        endTime: allday ? null : moment(end).format('h:mm A'),
        summary: event.summary || 'Untitled Event',
        description: event.description,
        location: event.location,
        calendarName,
        allday,
        duration: allday ? null : moment(end).diff(moment(start), 'hours', true)
    };
};

/**
 * Merge events by date into date-keyed lifelog structure
 * @param {Object} existing - Existing date-keyed lifelog data
 * @param {Array} newEvents - New events to merge
 * @returns {Object} Merged date-keyed data
 */
const mergeEventsByDate = (existing, newEvents) => {
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
};

const listCalendarEvents = async (logger, job_id, targetUsername = null) => {
    const log = logger || defaultGcalLogger;
    
    // System-level OAuth app credentials (shared across all users)
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    
    // User-level auth (personal refresh token)
    const username = targetUsername || getDefaultUsername();
    const auth = configService.getUserAuth('google', username) || {};
    const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

    if(!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
        throw new Error('Google Calendar credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    // List available calendars
    const { data: list } = await calendar.calendarList.list();
    const now = new Date();
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(now.getDate() - 42);
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(now.getDate() + 42);

    // === CURRENT DATA: Upcoming events (next 6 weeks) ===
    let upcomingEvents = [];
    for (const cal of list.items) {
        if(!cal.selected) continue;
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: now.toISOString(),
            timeMax: sixWeeksFromNow.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        upcomingEvents = upcomingEvents.concat(data.items);
    }

    //sort 
    upcomingEvents.sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date));
    
    // Save to household shared location (calendar is household-level)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/calendar`, upcomingEvents);
    
    // Also save to user current/
    userSaveCurrent(username, 'calendar', upcomingEvents);
    
    // === LIFELOG DATA (Phase 2: date-keyed past events) ===
    let pastEvents = [];
    for (const cal of list.items) {
        if(!cal.selected) continue;
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: sixWeeksAgo.toISOString(),
            timeMax: now.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        const calendarName = cal.summary || cal.id;
        pastEvents = pastEvents.concat(
            data.items.map(event => formatEvent(event, calendarName))
        );
    }
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'calendar') || {};
    
    // Handle migration: if existing data is an array (old format), start fresh
    const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
    const updatedLifelog = mergeEventsByDate(existingDateKeyed, pastEvents);
    userSaveFile(username, 'calendar', updatedLifelog);

    log.info('harvest.gcal.complete', { 
        jobId: job_id, 
        upcoming: upcomingEvents.length,
        past: pastEvents.length 
    });
    
    saveEvents(job_id);
    return { upcoming: upcomingEvents.length, past: pastEvents.length };
}

export default listCalendarEvents;