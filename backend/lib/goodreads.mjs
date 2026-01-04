import { userSaveFile, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import Parser from 'rss-parser';
let parser = new Parser();

const getBooks = async (targetUsername = null) => {
    // User-level auth (personal Goodreads user ID)
    const username = targetUsername || getDefaultUsername();
    const auth = configService.getUserAuth('goodreads', username) || {};
    const GOODREADS_USER = auth.user_id || process.env.GOODREADS_USER;
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
    userSaveFile(username, 'goodreads', books);
    return books;
}

export default getBooks