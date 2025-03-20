
import { loadFile, saveFile } from '../lib/io.mjs';
export default async (job_id) => {


    const calendarEvents = loadFile('calendar') || [];
    const todoItems = loadFile('todoist') || [];

    const calendarItems = calendarEvents.map(event => {
        const { id, start, end, summary, description, location,  organizer: {displayName: calendarName} } = event;
        const domain = location && location.match(/https?:\/\/([^\/]+)/) ? location.match(/https?:\/\/([^\/]+)/)[1] : null;
        const allday = !!(start.date && !start.dateTime);
        return { id, start: start.dateTime || start.date, end: end.dateTime || end.date, duration: (new Date(end.dateTime || end.date) - new Date(start.dateTime || start.date)) / 1000 / 60 / 60, summary, description, type: 'calendar', calendarName, location, domain, allday };
    }).filter(event => !(/ birthday$/i.test(event.summary)));

    
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

    const allItems = [...calendarItems, ...todoistItems].sort((a, b) => new Date(a.start) - new Date(b.start));

    saveFile('events', allItems);

    return allItems;



}