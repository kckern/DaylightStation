import { google } from 'googleapis';
import { saveFile, sanitize } from './io.js';

const listCalendarEvents = async (job_id) => {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;

    if(!(GOOGLE_CLIENT_ID || GOOGLE_CLIENT_SECRET || GOOGLE_REDIRECT_URI || GOOGLE_REFRESH_TOKEN)) {
        throw new Error('Google Calendar credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    const now = new Date();
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(now.getDate() + 42); // 6 weeks = 42 days

    const { data } = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: sixWeeksFromNow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
    });

    const events = data.items.map(event => {
        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;
        const summary = sanitize(event.summary);
        const description = sanitize(event.description);

        return { start, end, summary, description };
    });

    console.log(`\t[${job_id}] Calendar: ${events.length} events found`);
    saveFile('calendar', events);
    return events;
}

export default listCalendarEvents;