import axios from 'axios';
import crypto from 'crypto';
import { saveFile } from './io.mjs';


const getScrobbles = async () => {
    const {LAST_FM_API_KEY,  LAST_FM_USER} = process.env;
    let page = 1;
    let tracks = [];
    while (page < 10) {
        const params = {
            'api_key': LAST_FM_API_KEY,
            'user': LAST_FM_USER,
            'limit': 200,
            'method': 'user.getRecentTracks',
            'page': page,
            'format': 'json'
        };
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?${new URLSearchParams(params).toString()}`);

        let recenttracks = response.data.recenttracks.track.map(track => {
            const unix = parseInt(track.date.uts);
            const date = track.date['#text'];
            const title = track.name;
            const artist = track.artist['#text'];
            const album = track.album['#text'];
            return { unix, date, artist, album, title };
        })
        page++;
        tracks = [...tracks, ...recenttracks].sort((a, b) => b.unix - a.unix);
    }
    saveFile('lastfm', tracks);
    return tracks;
}

export default getScrobbles

