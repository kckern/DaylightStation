import { loadFile, saveFile } from './io.mjs';
import axios from 'axios';
import fs from 'fs';
 
const mediaPath = process.env.path.media;
const downloadVideos = async () => {

    const items = loadFile('youtube_ondeck');
    const keys = Object.keys(items);
    for(const key of keys) {
        const item = items[key];
        if (!item || !item.video_url) continue;
        const {video_url,youtube_id} = item;
        //skip if txt file already has youtube_id
        if (fs.existsSync(`${mediaPath}/news/${item.shortcode}.txt`)) {
            const existingContent = fs.readFileSync(`${mediaPath}/news/${item.shortcode}.txt`, 'utf-8');
            if (existingContent.includes(item.youtube_id)) {
            console.log(`Already downloaded ${item.shortcode}`);
            continue;
            }
        }
        console.log(`Downloading video for ${item.shortcode}`);
        const response = await axios({
            method: 'get',
            url: video_url,
            responseType: 'stream'
        });

        const totalLength = response.headers['content-length'];
        const megabytes = (totalLength / 1024 / 1024).toFixed(2);
        console.log(`Starting download for ${item.shortcode}. Total size: ${totalLength} bytes`);

        const writer = fs.createWriteStream(`${mediaPath}/news/${item.shortcode}.mp4`);
        let downloadedLength = 0;

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            const downloadedLengthInMB = (downloadedLength / 1024 / 1024).toFixed(2);
            console.log(`Progress for ${item.shortcode}: ${(downloadedLength / totalLength * 100).toFixed(2)}% (${downloadedLengthInMB}/${megabytes} MB)`);
        });

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        //write ytid to shortcode.txt
        fs.writeFileSync(`${mediaPath}/news/${item.shortcode}.txt`, item.youtube_id);
        console.log(`Download complete for ${item.shortcode}`);
    }



    return items

}

export default downloadVideos;