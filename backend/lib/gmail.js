import { google } from 'googleapis';
import { saveFile,sanitize } from './io.mjs';
import { createLogger, logglyTransportAdapter } from './logging/index.js';

const defaultGmailLogger = createLogger({
    name: 'backend-gmail',
    context: { app: 'backend', module: 'gmail' },
    level: process.env.GMAIL_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
    transports: [logglyTransportAdapter({ tags: ['backend', 'gmail'] })]
});

const listMails = async (logger, job_id) => {
    const log = logger || defaultGmailLogger;
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

        const subject = sanitize(headers.find(header => header.name === 'Subject')?.value || 'No Subject');
        const from = sanitize(headers.find(header => header.name === 'From')?.value || 'Unknown Sender');
        const to = sanitize(headers.find(header => header.name === 'To')?.value || 'Unknown Recipient');
        const snippet = sanitize(data.snippet);

        return { subject, from, to, snippet };
    }));

    log.info('harvest.gmail.messages', { jobId: job_id, count: messages.length });
    saveFile('lifelog/gmail', messages);
    return messages;
}

export default listMails
