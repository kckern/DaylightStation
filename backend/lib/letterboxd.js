import { saveFile } from './io.mjs';
import axios from 'axios';
 

const getMovies = async () => {
    const {LETTERBOXD_USER} = process.env;
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
    saveFile('lifelog/letterboxd', movies);
    return movies;
}

export default getMovies