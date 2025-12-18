import { TodoistApi } from '@doist/todoist-api-typescript';
import { saveFile, userSaveFile } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';

// Get default username for user-scoped data
const getDefaultUsername = () => configService.getHeadOfHousehold();

const defaultTodoistLogger = createLogger({
        source: 'backend',
        app: 'todoist'
});

const getTasks = async (logger, job_id) => {
        const log = logger || defaultTodoistLogger;
        const { TODOIST_KEY } = process.env;
        if(!TODOIST_KEY) throw new Error('Todoist API key not found in .env file');
        const api = new TodoistApi(TODOIST_KEY);
        const tasks = await api.getTasks();
        log.info('harvest.todoist.tasks', { jobId: job_id, count: tasks.length });
        const username = getDefaultUsername();
        // Save to user-namespaced location
        userSaveFile(username, 'todoist', tasks);
        saveEvents(job_id);
        return tasks;
};

export default getTasks;