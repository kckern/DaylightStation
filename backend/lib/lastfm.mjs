import axios from './http.mjs';
import crypto from 'crypto';
import { userSaveFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';

const getScrobbles = async (targetUsername = null) => {
    // System-level API key (shared app key)
    const { LAST_FM_API_KEY } = process.env;
    
    // User-level auth (personal username)
    const username = targetUsername || getDefaultUsername();
    const auth = userLoadAuth(username, 'lastfm') || {};
    const LAST_FM_USER = auth.username || process.env.LAST_FM_USER;
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
    userSaveFile(username, 'lastfm', tracks);
    return tracks;
}

export default getScrobbles

