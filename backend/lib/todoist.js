import { TodoistApi } from '@doist/todoist-api-typescript'
import { saveFile, loadFile } from './io.mjs';
import saveEvents from '../jobs/events.mjs';


const getTasks = async (job_id) => {
        const { TODOIST_KEY } = process.env
        if(!TODOIST_KEY) Error('Todoist API key not found in .env file');
        const api = new TodoistApi(TODOIST_KEY);
        const tasks = await api.getTasks()
        console.log(`\t[${job_id}] Todoist: ${tasks.length} tasks found`);
        saveFile('lifelog/todoist', tasks);
        saveEvents(job_id);
        return tasks;
}

export default getTasks