import { TodoistApi } from '@doist/todoist-api-typescript';
import { saveFile, userSaveFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';

const defaultTodoistLogger = createLogger({
        source: 'backend',
        app: 'todoist'
});

const getTasks = async (logger, job_id, targetUsername = null) => {
        const log = logger || defaultTodoistLogger;
        
        // User-level auth
        const username = targetUsername || getDefaultUsername();
        const auth = userLoadAuth(username, 'todoist') || {};
        const apiKey = auth.api_key || process.env.TODOIST_KEY;
        
        if(!apiKey) throw new Error('Todoist API key not found');
        const api = new TodoistApi(apiKey);
        const tasks = await api.getTasks();
        log.info('harvest.todoist.tasks', { jobId: job_id, count: tasks.length });
        // Save to user-namespaced location
        userSaveFile(username, 'todoist', tasks);
        saveEvents(job_id);
        return tasks;
};

export default getTasks;