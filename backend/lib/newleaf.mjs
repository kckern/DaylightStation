import { loadFile, saveFile } from './io.mjs';
import axios from 'axios';
import moment from 'moment';
 

const getYoutube = async () => {
    const {YOUTUBE_API_KEY, newleaf_host} = process.env;
    const youtubeData = loadFile('youtube');
    const oldestDate = moment().subtract(10, 'days').format('YYYY-MM-DD');
    const selections = [];
    for(const item of youtubeData) {
        const {description, type, shortcode, playlist, volume, sort, uid, folder} = item;
        const endpoint = type === 'Channel' 
            ? `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${playlist}&key=${YOUTUBE_API_KEY}&maxResults=50`
            : `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlist}&key=${YOUTUBE_API_KEY}&maxResults=50`;

            const {data} = await axios.get(endpoint);
        if (!data || !data.items) continue;
        const {items} = data;
        selections.push(items.map(({id, snippet}) => ({
            shortcode: shortcode,
            src: description,
            title: snippet.title,
            description: snippet.description,
            youtube_id: snippet.resourceId?.videoId || id.videoId,
            thumbnail: snippet.thumbnails.maxres?.url || snippet?.thumbnails?.default?.url.replace(/default/g, 'maxresdefault'),
            date: moment(snippet.publishedAt).format('YYYY-MM-DD'),
            ytdlp: `yt-dlp -f '[height<=720]/best' -o '${process.env.path.media}/news/${shortcode}.%(ext)s' '${snippet.resourceId?.videoId || id.videoId}'`,
            }))
            .filter(item => !!item.thumbnail)
            .filter(item => moment(item.date).isAfter(oldestDate))
            //todo: filter by already watched
            .sort((a, b) => a.date < b.date ? 1 : -1)[0]);
    }

 

    const dictionary = selections.reduce((acc, item) => {
        if (!item || !item.shortcode) return acc;
        const {shortcode} = item;
        acc[shortcode] = selections.find(i => i && i.shortcode === shortcode)
        return acc;
    }, {});

    saveFile('youtube_ondeck', dictionary);

    return dictionary || [];


}

export default getYoutube;