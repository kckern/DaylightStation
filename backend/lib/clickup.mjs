import axios from './http.mjs';
import { buildCurl } from './httpUtils.mjs';
import { saveFile, userSaveFile, userLoadFile, userSaveCurrent, getCurrentHouseholdId } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';
import moment from 'moment';

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();

const clickupLogger = createLogger({
    source: 'backend',
    app: 'clickup'
});

/**
 * Get ClickUp auth from household config
 * Falls back to env during migration
 */
const getClickUpAuth = () => {
    const hid = getCurrentHouseholdId();
    const auth = configService.getHouseholdAuth('clickup', hid) || {};
    return {
        apiKey: auth.api_key || process.env.CLICKUP_PK,
        workspaceId: auth.workspace_id || process.env.clickup?.team_id
    };
};

/**
 * Merge tasks by date into date-keyed lifelog structure
 * Handles created and completed tasks
 * @param {Object} existing - Existing date-keyed lifelog data
 * @param {Array} newTasks - New tasks to merge (with date and action fields)
 * @returns {Object} Merged date-keyed data
 */
const mergeTasksByDate = (existing, newTasks) => {
    const merged = { ...existing };
    for (const task of newTasks) {
        if (!task.date) continue;
        if (!merged[task.date]) merged[task.date] = [];
        // Use composite key of id + action to allow same task as created AND completed
        const isDupe = merged[task.date].find(t => 
            t.id === task.id && t.action === task.action
        );
        if (!isDupe) {
            merged[task.date].push(task);
        }
    }
    // Sort each day's tasks by time
    for (const date of Object.keys(merged)) {
        merged[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    return merged;
};

const getTickets = async () => {
    const { apiKey } = getClickUpAuth();
    const { clickup: { statuses, team_id } } = process.env;

    // Fetch spaces
    const { data: { spaces } } = await axios.get(
        `https://api.clickup.com/api/v2/team/${team_id}/space`,
        { headers: { Authorization: apiKey } }
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
            const { data: team_tickets } = await axios.get(url, { headers: { Authorization: apiKey } });
            tickets = [...tickets, ...team_tickets.tasks];
            lastPage = team_tickets.last_page;
            page++;
        } catch (error) {
            clickupLogger.error('Error fetching tickets', { message: error?.shortMessage || error.message, url });
            if (process.env.DEBUG_CURL === '1') {
                const curlString = buildCurl({ method: 'GET', url, headers: { Authorization: apiKey } });
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
    const username = getDefaultUsername();
    
    // === CURRENT DATA: In-progress tasks ===
    userSaveCurrent(username, 'clickup', {
        lastUpdated: new Date().toISOString(),
        taskCount: tickets.length,
        tasks: tickets
    });
    
    // === LIFELOG DATA (Phase 2: date-keyed CREATED and COMPLETED tasks) ===
    // Note: Status change tracking requires ClickUp paid plan (time_in_status API)
    const sevenDaysAgo = moment().subtract(7, 'days');
    let lifelogTasks = [];
    
    // 1. Track CREATED tasks from current tickets (by date_created)
    const createdTasks = tickets
        .filter(t => t.date_created && moment(parseInt(t.date_created)).isAfter(sevenDaysAgo))
        .map(t => ({
            id: t.id,
            name: t.name,
            time: moment(parseInt(t.date_created)).format('HH:mm'),
            date: moment(parseInt(t.date_created)).format('YYYY-MM-DD'),
            status: t.status,
            taxonomy: t.taxonomy,
            action: 'created'
        }));
    lifelogTasks.push(...createdTasks);
    
    // 2. Fetch COMPLETED tasks (done status) from last 7 days
    const { clickup: { done_statuses } } = process.env;
    const doneStatusList = done_statuses || ['done', 'complete', 'closed'];
    
    try {
        // Build params for done statuses
        const doneParams = { subtasks: true };
        doneStatusList.forEach((status, index) => {
            doneParams[`statuses[${index}]`] = status;
        });
        
        const doneUrl = `https://api.clickup.com/api/v2/team/${team_id}/task?${new URLSearchParams(doneParams)}`;
        const { data: doneData } = await axios.get(doneUrl, { headers: { Authorization: apiKey } });
        
        // Filter to last 7 days and format as completed
        const completedTasks = (doneData.tasks || [])
            .filter(t => {
                const doneDate = t.date_done || t.date_updated;
                return doneDate && moment(parseInt(doneDate)).isAfter(sevenDaysAgo);
            })
            .map(t => {
                const doneDate = t.date_done || t.date_updated;
                return {
                    id: t.id,
                    name: t.name,
                    time: moment(parseInt(doneDate)).format('HH:mm'),
                    date: moment(parseInt(doneDate)).format('YYYY-MM-DD'),
                    taxonomy: Object.entries(taxonomyFields).reduce((acc, [keyPath, value]) => {
                        const [key1, key2] = keyPath.split('/');
                        const keyVal = t[key1] ? t[key1][key2] : null;
                        if (typeof value === 'function') {
                            acc[keyVal] = value(keyVal);
                        } else {
                            const [val1, val2] = value.split('/');
                            acc[keyVal] = t[val1] ? t[val1][val2] : null;
                        }
                        return acc;
                    }, {}),
                    action: 'completed'
                };
            });
        
        lifelogTasks.push(...completedTasks);
        
    } catch (error) {
        clickupLogger.warn('clickup.completedFetch.failed', { error: error?.message || error });
    }
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'clickup') || {};
    
    // Handle migration: if existing data is an array (old format), start fresh
    const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
    const updatedLifelog = mergeTasksByDate(existingDateKeyed, lifelogTasks);
    userSaveFile(username, 'clickup', updatedLifelog);
    
    const createdCount = lifelogTasks.filter(t => t.action === 'created').length;
    const completedCount = lifelogTasks.filter(t => t.action === 'completed').length;
    
    clickupLogger.info('Tickets saved', { 
        current: tickets.length, 
        lifelog: { created: createdCount, completed: completedCount }
    });

    return { current: tickets.length, lifelog: { created: createdCount, completed: completedCount } };
};

export default getTickets;
