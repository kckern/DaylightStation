import { google } from 'googleapis';
import { saveFile, sanitize } from './io.mjs';
import saveEvents from '../jobs/events.mjs';

const listCalendarEvents = async (job_id) => {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;

    if(!(GOOGLE_CLIENT_ID || GOOGLE_CLIENT_SECRET || GOOGLE_REDIRECT_URI || GOOGLE_REFRESH_TOKEN)) {
        throw new Error('Google Calendar credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

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

    console.log(`\t[${job_id}] Calendar: ${allEvents.length} events found`);
    saveFile('calendar', allEvents);
    saveEvents(job_id);
    return allEvents;
}

export default listCalendarEvents;