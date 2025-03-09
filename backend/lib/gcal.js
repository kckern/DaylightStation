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

        const events = data.items.map(event => {
            const start = event.start.dateTime || event.start.date;
            const end = event.end.dateTime || event.end.date;
            const summary = sanitize(event.summary);
            const description = sanitize(event.description);
            const calendar = sanitize(cal.summary);
            const duration = (new Date(end) - new Date(start) ) / 1000 / 60 / 60;

            return { start, end, summary, description , calendar , duration };
        })
        //filter birthdays
        .filter(event => !(/ birthday$/i.test(event.summary) && event.duration === 24));

        allEvents = allEvents.concat(events);
    }

    //sort 
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

    console.log(`\t[${job_id}] Calendar: ${allEvents.length} events found`);
    saveFile('calendar', allEvents);
    return allEvents;
}

export default listCalendarEvents;