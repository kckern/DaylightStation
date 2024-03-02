import { TodoistApi } from '@doist/todoist-api-typescript'
import { saveFile, loadFile } from './io.js';
import dotenv from 'dotenv';
dotenv.config();

const getTasks = async (req,res) => {
    try {
        const { TODOIST_KEY } = process.env
        if(!TODOIST_KEY) return res.status(500).json({error: 'TODOIST_KEY not found in .env file'})
        const api = new TodoistApi(TODOIST_KEY);
        const tasks = await api.getTasks()
        saveFile('tasks.json', tasks);
        res.status(200).json(tasks)
    } catch (error) {
        res.status(500).json({error: error.message})
    }
}

export default getTasks