
import { loadFile, saveFile } from '../lib/io.mjs';
export default async (job_id) => {


    const calendarEvents = loadFile('calendar') || [];
    const todoItems = loadFile('todoist') || [];

    const calendarItems = calendarEvents.map(event => {
        const { start, end, summary, description } = event;
        return { start: start.dateTime || start.date, end: end.dateTime || end.date, duration: (new Date(end.dateTime || end.date) - new Date(start.dateTime || start.date)) / 1000 / 60 / 60, summary, description, type: 'calendar' };
    }).filter(event => !(/ birthday$/i.test(event.summary) && event.duration === 24));

    const todoistItems = todoItems.map(item => {
        const { content, description, due, url } = item;
        return { start: due, summary: content, description, type: 'todoist', url };
    });

    const allItems = [...calendarItems, ...todoistItems].sort((a, b) => new Date(a.start) - new Date(b.start));

    saveFile('events', allItems);

    return allItems;



}