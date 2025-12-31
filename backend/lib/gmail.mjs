import { google } from 'googleapis';
import { saveFile, sanitize, userSaveFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';

const defaultGmailLogger = createLogger({
    source: 'backend',
    app: 'gmail'
});

const listMails = async (logger, job_id, targetUsername = null) => {
    const log = logger || defaultGmailLogger;
    
    // System-level OAuth app credentials (shared across all users)
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    
    // User-level auth (personal refresh token)
    const username = targetUsername || getDefaultUsername();
    const auth = userLoadAuth(username, 'google') || {};
    const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

    if(!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
        throw new Error('Gmail credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

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
    const username = getDefaultUsername();
    // Save to user-namespaced location
    userSaveFile(username, 'gmail', messages);
    return messages;
}

export default listMails
