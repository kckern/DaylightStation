import { google } from 'googleapis';
import { saveFile, sanitize, userSaveFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';

const defaultGcalLogger = createLogger({
    source: 'backend',
    app: 'gcal'
});

const listCalendarEvents = async (logger, job_id, targetUsername = null) => {
    const log = logger || defaultGcalLogger;
    
    // System-level OAuth app credentials (shared across all users)
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    
    // User-level auth (personal refresh token)
    const username = targetUsername || getDefaultUsername();
    const auth = userLoadAuth(username, 'google') || {};
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
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(now.getDate() + 42); // 6 weeks = 42 days

    let allEvents = [];

    for (const cal of list.items) {
        if(!cal.selected) continue;
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: now.toISOString(),
            timeMax: sixWeeksFromNow.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = data.items;
        allEvents = allEvents.concat(events);
    }

    //sort 
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

    log.info('harvest.gcal.events', { jobId: job_id, count: allEvents.length });
    // Save to household shared location (calendar is household-level)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/calendar`, allEvents);
    saveEvents(job_id);
    return allEvents;
}

export default listCalendarEvents;