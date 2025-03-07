import { TodoistApi } from '@doist/todoist-api-typescript'
import { saveFile, loadFile } from './io.js';

const getTasks = async (job_id) => {
        const { TODOIST_KEY } = process.env
        if(!TODOIST_KEY) Error('Todoist API key not found in .env file');
        const api = new TodoistApi(TODOIST_KEY);
        const tasks = await api.getTasks()
        console.log(`\t[${job_id}] Todoist: ${tasks.length} tasks found`);
        saveFile('tasks', tasks);
        return tasks;
}

export default getTasks