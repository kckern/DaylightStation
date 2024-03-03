import { TodoistApi } from '@doist/todoist-api-typescript'
import { saveFile, loadFile } from './io.js';
import dotenv from 'dotenv';
dotenv.config();

const getTasks = async () => {
        const { TODOIST_KEY } = process.env
        if(!TODOIST_KEY) Error('Todoist API key not found in .env file');
        const api = new TodoistApi(TODOIST_KEY);
        const tasks = await api.getTasks()
        saveFile('tasks', tasks);
        return tasks;
}

export default getTasks