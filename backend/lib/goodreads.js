import { saveFile } from './io.mjs';
import Parser from 'rss-parser';
let parser = new Parser();
 
const getMovies = async () => {
    const {GOODREADS_API_KEY, GOODREADS_USER} = process.env;
    let url = `https://www.goodreads.com/review/list_rss/${GOODREADS_USER}?&shelf=read`;
    const feed = await parser.parseURL(url);
    let books = feed.items.map(item => {
        const readAt = item.content.match(/read at: (\d{4}\/\d{2}\/\d{2})/i)?.[1]?.replace(/\//g, '-') || '';
        const rating = parseInt(item.content.match(/rating: (\d)/i)?.[1]) || '';
        const author = item.content.match(/author: (.*?)<br\/>/i)?.[1].replace(/\s+/g, ' ').trim() || '';
        const bookId = parseInt(item.link.match(/review\/show\/(\d+)/i)?.[1]);
        const review = item.contentSnippet || null
        return {
            bookId,
            title: item.title.replace(/\s+/g, ' ').trim(),
            author,
            readAt,
            rating,
            review,

        }

    }).sort((a, b) => new Date(b.readAt) - new Date(a.readAt));
    saveFile('goodreads', books);
    return books;
}

export default getMovies