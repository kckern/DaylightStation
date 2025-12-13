import axios from './http.mjs';
import { buildCurl } from './httpUtils.mjs';
import { saveFile } from './io.mjs';
import { createLogger } from './logging/logger.js';

const clickupLogger = createLogger({
    source: 'backend',
    app: 'clickup'
});

const getTickets = async () => {
    const { CLICKUP_PK, clickup: { statuses, team_id } } = process.env;

    // Fetch spaces
    const { data: { spaces } } = await axios.get(
        `https://api.clickup.com/api/v2/team/${team_id}/space`,
        { headers: { Authorization: CLICKUP_PK } }
    );

    const spacesDict = spaces.reduce((acc, space) => {
        acc[space.id] = space.name;
        return acc;
    }, {});

    // Fetch tickets
    const params = { subtasks: true };
    statuses.forEach((status, index) => {
        params[`statuses[${index}]`] = status;
    });

    let tickets = [];
    let lastPage = false;
    let page = 0;

    while (!lastPage) {
        const url = `https://api.clickup.com/api/v2/team/${team_id}/task?${new URLSearchParams({ ...params, page })}`;
        try {
            const { data: team_tickets } = await axios.get(url, { headers: { Authorization: CLICKUP_PK } });
            tickets = [...tickets, ...team_tickets.tasks];
            lastPage = team_tickets.last_page;
            page++;
        } catch (error) {
            clickupLogger.error('Error fetching tickets', { message: error?.shortMessage || error.message, url });
            if (process.env.DEBUG_CURL === '1') {
                const curlString = buildCurl({ method: 'GET', url, headers: { Authorization: CLICKUP_PK } });
                clickupLogger.warn('Debug CURL', { curl: curlString });
            }
            break; // Exit the loop on error
        }
    }

    // Process tickets
    const fieldsToKeep = [ 'name', 'status/status', 'id', 'date_created'];
    const taxonomyFields = {
        'space/id': key=> spacesDict[key],
        'project/id': 'project/name',
        'list/id':'list/name'};

    tickets = tickets.map(ticket => {
        const newTicket = {};

        // Build taxonomy object
        newTicket.taxonomy = Object.entries(taxonomyFields).reduce((acc, [keyPath, value]) => {

            const [key1, key2] = keyPath.split('/');
            const keyVal = ticket[key1] ? ticket[key1][key2] : null;

            if (typeof value === 'function') {
                acc[keyVal] = value(keyVal);
            } else {
                const [val1, val2] = value.split('/');
                acc[keyVal] = ticket[val1] ? ticket[val1][val2] : null;
            }
            return acc;
        }, {});

        // Remove hidden or empty values from taxonomy
        newTicket.taxonomy = Object.fromEntries(
            Object.entries(newTicket.taxonomy).filter(([_, val]) => val && val !== 'hidden')
        );

        // Keep specific fields
        fieldsToKeep.forEach(field => {
            const [lev1, lev2] = field.split('/');
            newTicket[lev1] = lev2 && ticket[lev1] ? ticket[lev1][lev2] : ticket[lev1];
        });

        return newTicket;
    });

    clickupLogger.info('Total tickets fetched', { count: tickets.length });
    saveFile('lifelog/clickup', tickets);
    clickupLogger.info('Tickets saved to file', { path: 'lifelog/clickup' });

    return tickets;
};

export default getTickets;
