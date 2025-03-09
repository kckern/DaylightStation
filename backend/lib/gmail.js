import { google } from 'googleapis';
import { saveFile,sanitize } from './io.mjs';

const listMails = async (job_id) => {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;

    if(!(GOOGLE_CLIENT_ID || GOOGLE_CLIENT_SECRET || GOOGLE_REDIRECT_URI || GOOGLE_REFRESH_TOKEN)) {
        Error('Gmail credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const { data } = await gmail.users.messages.list({ userId: 'me', q: 'is:inbox' });


    const messages = await Promise.all(data.messages.map(async message => {
        const { data } = await gmail.users.messages.get({ userId: 'me', id: message.id });
        const payload = data.payload;
        const headers = payload.headers;

        const subject = sanitize(headers.find(header => header.name === 'Subject').value);
        const from = sanitize(headers.find(header => header.name === 'From').value);
        const to = sanitize(headers.find(header => header.name === 'To').value);
        const snippet = sanitize(data.snippet);

        return { subject, from, to, snippet };
    }));

    console.log(`\t[${job_id}] Gmail: ${messages.length} messages found`);
    saveFile('gmail', messages);
    return messages;
}

export default listMails
