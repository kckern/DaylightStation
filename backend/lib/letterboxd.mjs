import { userSaveFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import axios from './http.mjs';

const getMovies = async (targetUsername = null) => {
    // User-level auth (personal Letterboxd username)
    const username = targetUsername || getDefaultUsername();
    console.log('[letterboxd] targetUsername:', targetUsername, 'resolved username:', username, 'type:', typeof username);
    const auth = userLoadAuth(username, 'letterboxd') || {};
    const LETTERBOXD_USER = auth.username || process.env.LETTERBOXD_USER;
    let page = 1;
    let movies = [];
    while (page < 10) {
        const response = await axios.get(`https://letterboxd.com/${LETTERBOXD_USER}/films/diary/page/${page}/`);
        let html = response.data;
        html = html.replace(/\n/g," ");
        let matches = html.match(/<a href=\"#\".*?Edit this entry<\/a>/gim)?.map(match => {
            let items = match.match(/([a-z-]+)=\"(.*?)\"/gim);
            let d = Object.fromEntries(items.map(item => item.split('=').map(i => i.replace(/"/g,''))));
            let tmp = {};
            tmp['date'] = d['data-viewing-date'];
            tmp['title'] = d['data-film-name'];
            tmp['rating'] = d['data-rating'];
            tmp['url'] = `https://letterboxd.com/${LETTERBOXD_USER}`+d['data-film-link'];
            return tmp;
        }) || [];
        if(!matches.length) break;
        page++;
        movies = [...movies, ...matches];
    }
    userSaveFile(username, 'letterboxd', movies);
    return movies;
}

export default getMovies