
import { loadFile, saveFile } from '../lib/io.mjs';
export default async (job_id) => {


    const calendarEvents = loadFile('calendar') || [];
    const todoItems = loadFile('todoist') || [];
    const clickupData = loadFile('clickup') || [];

    const calendarItems = calendarEvents.map(event => {
        const { id, start, end, summary, description, location,  organizer: {displayName: calendarName} } = event;
        const domain = location && location.match(/https?:\/\/([^\/]+)/) ? location.match(/https?:\/\/([^\/]+)/)[1] : null;
        const allday = !!(start.date && !start.dateTime);
        return { id, start: start.dateTime || start.date, end: end.dateTime || end.date, duration: (new Date(end.dateTime || end.date) - new Date(start.dateTime || start.date)) / 1000 / 60 / 60, summary, description, type: 'calendar', calendarName, location, domain, allday };
        }).filter(event => !(/ birthday$/i.test(event.summary)))
        .reduce((acc, event) => {
        if (!acc.some(e => e.id === event.id || (e.start === event.start && e.summary === event.summary))) acc.push(event);
        return acc;
        }, []);

    
    const todoistItems = todoItems.map(item => {
        const { id, content, description, due, url } = item;
        let extractedContent = content;
        let extractedUrl = url;
        const markdownMatch = content.match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
        if (markdownMatch) {
            extractedContent = markdownMatch[1]; // Extract the text inside the square brackets
            extractedUrl = markdownMatch[2]; // Extract the URL inside the parentheses
        }
        const domain = extractedUrl && extractedUrl.match(/https?:\/\/([^\/]+)/) ? extractedUrl.match(/https?:\/\/([^\/]+)/)[1] : null;
        return { id, start: due ? new Date(due).toISOString() : null, summary: extractedContent, description, type: 'todoist', domain, url: extractedUrl };
    });

    const lists = process.env.clickup?.todo_lists || null
    const count = process.env.clickup?.todo_count || 3;
    const statuses = process.env.clickup?.statuses || null;
    const clickupItems = clickupData.map(item => {
        const { taxonomy, name,status, id } = item;
        const uppercaseStatus = status && status.toUpperCase();
        if(!statuses.includes(status)) return false;
        const listIds = Object.keys(taxonomy).map(Number);
        if(!listIds.some(listId => lists.includes(listId))) return false;
        const start =  null;
        const url = `https://app.clickup.com/t/${id}`;
        const domain = url && url.match(/https?:\/\/([^\/]+)/) ? url.match(/https?:\/\/([^\/]+)/)[1] : null;
        const summary = `${name} (${Object.values(taxonomy).join(' › ')})`;
        return { id, start, status:uppercaseStatus, summary,  type: 'clickup', url, domain };
    }).filter(Boolean)
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
        


    const allItems = [...calendarItems, ...todoistItems, ...clickupItems].sort((a, b) => new Date(a.start) - new Date(b.start));

    saveFile('events', allItems);

    return allItems;



}