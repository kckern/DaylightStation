import { TodoistApi } from '@doist/todoist-api-typescript';
import { saveFile, userSaveFile, userLoadFile, userSaveCurrent, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';
import axios from './http.mjs';
import moment from 'moment';

const defaultTodoistLogger = createLogger({
        source: 'backend',
        app: 'todoist'
});

/**
 * Merge tasks by date into date-keyed lifelog structure
 * Handles both created and completed tasks
 * @param {Object} existing - Existing date-keyed lifelog data
 * @param {Array} newTasks - New tasks to merge (with date and action fields)
 * @returns {Object} Merged date-keyed data
 */
const mergeTasksByDate = (existing, newTasks) => {
    const merged = { ...existing };
    for (const task of newTasks) {
        if (!task.date) continue;
        if (!merged[task.date]) merged[task.date] = [];
        // Use composite key of id + action to allow same task to appear as created AND completed
        const existingTask = merged[task.date].find(t => t.id === task.id && t.action === task.action);
        if (!existingTask) {
            merged[task.date].push(task);
        }
    }
    // Sort each day's tasks by time
    for (const date of Object.keys(merged)) {
        merged[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    return merged;
};

const getTasks = async (logger, job_id, targetUsername = null) => {
        const log = logger || defaultTodoistLogger;
        
        // User-level auth
        const username = targetUsername || getDefaultUsername();
        const auth = userLoadAuth(username, 'todoist') || {};
        const apiKey = auth.api_key || process.env.TODOIST_KEY;
        
        if(!apiKey) throw new Error('Todoist API key not found');
        const api = new TodoistApi(apiKey);
        
        // === CURRENT DATA: Open tasks ===
        const tasks = await api.getTasks();
        
        // Format tasks for current/ with relevant fields
        const currentTasks = tasks.map(task => ({
            id: task.id,
            content: task.content,
            description: task.description,
            priority: task.priority,
            dueDate: task.due?.date || null,
            dueString: task.due?.string || null,
            projectId: task.projectId,
            labels: task.labels,
            url: task.url
        }));
        
        userSaveCurrent(username, 'todoist', {
            lastUpdated: new Date().toISOString(),
            taskCount: currentTasks.length,
            tasks: currentTasks
        });
        
        // === LIFELOG DATA (Phase 2: date-keyed created AND completed tasks) ===
        let lifelogTasks = [];
        const sevenDaysAgo = moment().subtract(7, 'days');
        
        try {
            // Fetch COMPLETED tasks from Activity Log
            const { data: completedActivity } = await axios.post(
                'https://api.todoist.com/sync/v9/activity/get',
                { event_type: 'item:completed', limit: 100 },
                { headers: { Authorization: `Bearer ${apiKey}` }}
            );
            
            const completedTasks = (completedActivity.events || [])
                .filter(event => moment(event.event_date).isAfter(sevenDaysAgo))
                .map(event => ({
                    id: event.object_id,
                    content: event.extra_data?.content || 'Unknown task',
                    time: moment(event.event_date).format('HH:mm'),
                    date: moment(event.event_date).format('YYYY-MM-DD'),
                    projectId: event.parent_project_id,
                    action: 'completed'
                }));
            
            lifelogTasks.push(...completedTasks);
            
            // Fetch CREATED tasks from Activity Log
            const { data: createdActivity } = await axios.post(
                'https://api.todoist.com/sync/v9/activity/get',
                { event_type: 'item:added', limit: 100 },
                { headers: { Authorization: `Bearer ${apiKey}` }}
            );
            
            const createdTasks = (createdActivity.events || [])
                .filter(event => moment(event.event_date).isAfter(sevenDaysAgo))
                .map(event => ({
                    id: event.object_id,
                    content: event.extra_data?.content || 'Unknown task',
                    time: moment(event.event_date).format('HH:mm'),
                    date: moment(event.event_date).format('YYYY-MM-DD'),
                    projectId: event.parent_project_id,
                    action: 'created'
                }));
            
            lifelogTasks.push(...createdTasks);
            
        } catch (error) {
            log.warn('harvest.todoist.activityFailed', { 
                jobId: job_id, 
                error: error?.message || error 
            });
        }
        
        // Merge into date-keyed lifelog
        const existingLifelog = userLoadFile(username, 'todoist') || {};
        
        // Handle migration: if existing data is an array (old format), start fresh
        const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
        const updatedLifelog = mergeTasksByDate(existingDateKeyed, lifelogTasks);
        userSaveFile(username, 'todoist', updatedLifelog);
        
        const createdCount = lifelogTasks.filter(t => t.action === 'created').length;
        const completedCount = lifelogTasks.filter(t => t.action === 'completed').length;
        
        log.info('harvest.todoist.complete', { 
            jobId: job_id, 
            current: tasks.length,
            lifelog: { created: createdCount, completed: completedCount }
        });
        
        saveEvents(job_id);
        return { current: tasks.length, lifelog: { created: createdCount, completed: completedCount } };
};

export default getTasks;