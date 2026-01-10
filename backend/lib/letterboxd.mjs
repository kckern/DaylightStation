import { userSaveFile } from './io.mjs';
import { configService } from './config/v2/index.mjs';
import axios from './http.mjs';

const getMovies = async (targetUsername = null) => {
    // User-level auth (personal Letterboxd username)
    const username = targetUsername || configService.getHeadOfHousehold();
    if (!username) throw new Error('Letterboxd: unable to resolve username');
    const auth = configService.getUserAuth('letterboxd', username) || {};
    const LETTERBOXD_USER = auth.username || process.env.LETTERBOXD_USER;
    let page = 1;
    let movies = [];
    while (page < 10) {
        const response = await axios.get(`https://letterboxd.com/${LETTERBOXD_USER}/films/diary/page/${page}/`);
        let html = response.data;
        html = html.replace(/\n/g, " ");

        // Extract diary entry rows - each row contains film data
        const rowMatches = html.match(/class="diary-entry-row[^"]*"[^>]*>.*?<\/tr>/gim) || [];

        let pageMovies = rowMatches.map(row => {
            // Extract date from the daydate link: href="/user/diary/films/for/YYYY/MM/DD/"
            const dateMatch = row.match(/class="daydate"[^>]*href="[^"]*\/for\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/"/i)
                || row.match(/href="[^"]*\/for\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/"[^>]*class="daydate"/i);

            // Extract film name from data-item-name attribute
            const titleMatch = row.match(/data-item-name="([^"]+)"/i);

            // Extract film link from data-item-link attribute
            const linkMatch = row.match(/data-item-link="([^"]+)"/i);

            // Extract rating from the rating input value (0-10 scale)
            const ratingMatch = row.match(/class="rateit-field[^"]*"[^>]*value="(\d+)"/i)
                || row.match(/value="(\d+)"[^>]*class="rateit-field/i);

            if (!dateMatch || !titleMatch) return null;

            const year = dateMatch[1];
            const month = dateMatch[2].padStart(2, '0');
            const day = dateMatch[3].padStart(2, '0');

            // Clean title - remove year suffix if present (e.g., "Film Name (2024)")
            let title = titleMatch[1];
            title = title.replace(/\s*\(\d{4}\)$/, '');

            return {
                date: `${year}-${month}-${day}`,
                title: title,
                rating: ratingMatch ? ratingMatch[1] : null,
                url: linkMatch ? `https://letterboxd.com${linkMatch[1]}` : null
            };
        }).filter(Boolean);

        if (!pageMovies.length) break;
        page++;
        movies = [...movies, ...pageMovies];
    }
    userSaveFile(username, 'letterboxd', movies);
    return movies;
}

export default getMovies