import { loadFile, saveFile } from './io.mjs';
import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
 

const getYoutube = async () => {
    const youtubeData = loadFile('config/youtube');
    const commands = [];
    const shortcodes = [];
    const mediaPath = `${process.env.path.media}/news`;
    const tenDaysAgo = moment().subtract(10, 'days').format('YYYYMMDD');
    const deleted = [];
    const clearOld = () => {
        const dirs = fs.readdirSync(mediaPath);
        for (const dir of dirs) {
            const dirPath = path.join(mediaPath, dir);
            if (fs.statSync(dirPath).isDirectory()) {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const fileNameYYYYMMDD = file.split('.')[0];
                    if (fileNameYYYYMMDD < tenDaysAgo) {
                        fs.unlinkSync(filePath);
                        deleted.push(filePath);
                        console.log(`Deleted old file: ${filePath}`);
                    }
                }
            }
        }
    };

    clearOld();

    for(const item of youtubeData) {
        const { type, shortcode, playlist, volume, sort, uid, folder} = item;
        const input = type === 'Channel' ? `'https://www.youtube.com/channel/${playlist}'` : `'${playlist}'`;
        const ytdlp =  `yt-dlp -f '[height<=720]/best' -o '${process.env.path.media}/news/${shortcode}/%(upload_date)s.%(ext)s' --max-downloads 1 --playlist-items 1 --match-filter "duration <= 900 & aspect_ratio>1" ${input}`;
        commands.push(ytdlp);
        shortcodes.push(`${shortcode}`);

        console.log(`Downloading ${shortcode} from ${playlist}`);
    }

    //run each command in parallel, dont wait for each command to finish
    const exec = promisify(child_process.exec);
    await Promise.all(commands.map(command => exec(command).catch(() => {})));

    //scan the news folder and get the list of files, recursive
    const folders = fs.readdirSync(mediaPath);
    const files = [];
    for (const folder of folders) {
        const folderPath = path.join(mediaPath, folder);
        if (fs.statSync(folderPath).isDirectory()) {
            const folderFiles = fs.readdirSync(folderPath);
            for (const file of folderFiles) {
                const filePath = path.join(folderPath, file);
                const stats = fs.statSync(filePath);
                if (stats.mtime > tenDaysAgo) {
                    files.push(filePath);
                    console.log(`Found file: ${filePath}`);
                }
            }
        }
    }

    
    return {deleted,shortcodes,files};


}

export default getYoutube;