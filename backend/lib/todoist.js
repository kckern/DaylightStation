import { TodoistApi } from '@doist/todoist-api-typescript';
import { saveFile } from './io.mjs';
import saveEvents from '../jobs/events.mjs';
import { createLogger } from './logging/logger.js';

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
        saveFile('lifelog/todoist', tasks);
        saveEvents(job_id);
        return tasks;
};

export default getTasks;