import axios from 'axios';
import express from 'express';
import fs from 'fs';
import {Plex} from './lib/plex.mjs';
import { loadFile, saveFile } from './lib/io.mjs';
import moment from 'moment';
import { parseFile } from 'music-metadata';
const mediaRouter = express.Router();
mediaRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));
const audioPath = `${process.env.path.audio}`;
const videoPath = `${process.env.path.video}`;
const notFound = `${audioPath}/${process.env.media.error}`;

const ext = ['mp3','mp4','m4a'];
const findFile = path => {
    path = path.replace(/^\//, '');
    const lastLeaf = path.split('/').pop();
    const extention = lastLeaf.split('.').length > 1 ? lastLeaf.split('.').pop() : null;
    const possiblePaths = extention 
        ? [audioPath, videoPath].map(p => `${p}/${path}`) 
        : ext.flatMap(e => [audioPath, videoPath].map(p => `${p}/${path}.${e}`));
    const firstMatch = possiblePaths.find(p => fs.existsSync(p));
    if(!firstMatch) console.log(`File not found: ${JSON.stringify(possiblePaths)}`);
    if(!firstMatch) return {path: notFound, fileSize: fs.statSync(notFound).size, mimeType: 'audio/mpeg'};
    const fileSize = firstMatch? fs.statSync(firstMatch).size : fs.statSync(notFound).size;
    const pathExtention = firstMatch?.split('.').pop();
    if(!firstMatch) return {path: notFound, fileSize, mimeType: 'audio/mpeg'};

    const mimeType = pathExtention === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    return {path: firstMatch, fileSize, extention:pathExtention, mimeType};
}


mediaRouter.get('/img/*', async (req, res) => {
    const imgPath = req.params[0]; // Capture the full path after /img/
    const baseDir = `${process.env.path.img}`;
    const filePathWithoutExt = `${baseDir}/${imgPath}`;
    const exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

    // Check for image file
    const ext = exts.find(e => fs.existsSync(`${filePathWithoutExt}.${e}`));
    if (ext) {
        const filePath = `${filePathWithoutExt}.${ext}`;
        const mimeType = `image/${ext}`;
        res.status(200).set({
            'Content-Type': mimeType,
            'Content-Length': fs.statSync(filePath).size,
            'Cache-Control': 'public, max-age=31536000',
            'Expires': new Date(Date.now() + 31536000000).toUTCString(),
            'Content-Disposition': `inline; filename="${imgPath}.${ext}"`,
            'Access-Control-Allow-Origin': '*'
        });
        return fs.createReadStream(filePath).pipe(res);
    }

    // Check for media file
    const mediaFile = findFile(imgPath);
    if (mediaFile.path !== notFound) {
        try {
            const { common: { picture } } = await parseFile(mediaFile.path);
            if (picture && picture.length) {
                const image = picture[0];
                const buffer = Buffer.from(image.data); // Convert data to a Buffer
                res.setHeader('Content-Type', image.format);
                res.setHeader('Content-Length', buffer.length);
                return res.status(200).send(buffer); // Send the buffer as the image
            }
        } catch (error) {
            console.error(`Error parsing media file for image: ${error.message}`);
        }
    }

    // Fallback to notfound image
    const notFoundPath = `${baseDir}/notfound.png`;
    res.status(404).set({
        'Content-Type': 'image/png',
        'Content-Length': fs.statSync(notFoundPath).size,
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Content-Disposition': `inline; filename="notfound.png"`,
        'Access-Control-Allow-Origin': '*'
    });
    return fs.createReadStream(notFoundPath).pipe(res);
});


mediaRouter.all('/queue/:queue_key/:queue_val/:action?', async (req, res) => {
    const queryParams = req.query;
    const shuffle = req.params.action === 'shuffle';
    const { queue_key, queue_val } = req.params;

    const predefinedQueues = {
        playlist: {
            morning: [
                { media: "program/cnn", mode: "mini" },
                { media: "program/bbc" },
                { media: "program/usdocs/gettysburg" },
                { scripture: "d&c 13", version: "redc" },
                { hymn: "113" },
                { plex: "481800", shuffle: true },
            ],
            evening: [
                { hymn: "1002" },
                { scripture: "d&c 93", version: "redc" },
            ],
        },
    };

    let queue = predefinedQueues[queue_key]?.[queue_val] || [];

    // Apply shuffle if requested
    if (shuffle) {
        queue = queue.sort(() => Math.random() - 0.5);
    }

    res.status(200).json({
        queue,
        queryParams,
        shuffle,
    });
    return;
});


mediaRouter.all('/plex/play/:plex_key', async (req, res) => {
    const plex_key = req.params.plex_key;
    const plexUrl = await ( new Plex()).loadMediaUrl(plex_key);
    try {
        const response = await axios.get(plexUrl);
        if (response.status !== 200) {
            res.status(response.status).json({ 
                error: 'Error fetching from Plex server', 
                status: response.status, 
                message: response.statusText,
                plexUrl: plexUrl
            });
            return;
        }
        res.redirect(plexUrl);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: plexUrl });
    }
});

mediaRouter.post('/log', async (req, res) => {
    const postData = req.body;
    const { type, id, percent, title } = postData;
    if (!type || !id || !percent) {
        return res.status(400).json({ error: `Invalid request: ${JSON.stringify(postData)}` });
    }
    try {
        const log = loadFile('_media_memory') || {};
        log[type] = log[type] || {};
        log[type][id] = { time: moment().format('YYYY-MM-DD hh:mm:ss a'), title, id, percent: parseFloat(percent) };
        if(!log[type][id].title) delete log[type][id].title;
        log[type] = Object.fromEntries(
            Object.entries(log[type]).sort(([, a], [, b]) => moment(b.time, 'YYYY-MM-DD hh:mm:ss a').diff(moment(a.time, 'YYYY-MM-DD hh:mm:ss a')))
        );
        saveFile('_media_memory', log);
        res.json({ response: log[type][id] });
    } catch (error) {
        console.error('Error handling /log:', error.message);
        res.status(500).json({ error: 'Failed to process log.' });
    }
});
mediaRouter.all(`/info/*`, async (req, res) => {
    const media = req.params[0]; // Capture the full path after /info/
    const thisHost = req.headers.host;
    const pathForMedia = `/media/${media}`;
    const mediaUrl = `http://${thisHost}${pathForMedia}`;
    const { fileSize,  extention } = findFile(media);
    res.json({
        key: media,
        title: media.split('/').pop(),
        mediaUrl,
        fileSize,
        extention,
        mediaType: ['mp3'].includes(extention) ? 'audio' : 'video',
        
    });
});

mediaRouter.all('/plex/info/:plex_key/:action?', async (req, res) => {
    const { plex_key, action } = req.params;
    const plex_keys = plex_key.split(',');
    const shuffle = action === 'shuffle';
    let infos = [];
    for (const key of plex_keys) {
        const info = await (new Plex()).loadPlayableItemFromKey(key, shuffle);
        infos.push(info);
    }
    //pick one
    const plexInfo = infos[Math.floor(Math.random() * infos.length)];
    try {
        res.json(plexInfo);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: plexUrl });
    }
});




mediaRouter.all('/plex/list/:plex_key/:action?', async (req, res) => {
    const { plex_key, action } = req.params;
    const plex_keys = plex_key.split(',');
    const shuffle = action === 'shuffle';
    let list = [];
    let info = {};
    for (const plex_key of plex_keys) {
        const {list:listItems, key, title, img} = await (new Plex()).loadChildrenFromKey(plex_key, shuffle);
        list = list.concat(listItems);
        info = {
            key: info.key ? `${info.key},${key}` : key,
            title: info.title ? `${info.title} • ${title}` : title,
            img: info.img ? `${info.img}` : img
        }
    }
    try {
        res.json({...info, list});
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message });
    }
});
mediaRouter.all('/plex/queue/:plex_key/:action?', async (req, res) => {
    const { plex_key, action } = req.params;
    const plex_keys = plex_key.split(',');
    const shuffle = action === 'shuffle';
    let list = [];
    let info = {};
    for (const plex_key of plex_keys) {
        const queue = await (new Plex()).loadPlayableQueueFromKey(plex_key, shuffle);
        list = list.concat(queue);
    }
    try {
        res.json(list);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message });
    }
});


mediaRouter.all('/plex/img/:plex_key', async (req, res) => {
    const { plex_key } = req.params;
    const imageUrl = await (new Plex()).loadImgFromKey(plex_key);
    try {
        const response = await axios.get(imageUrl, { responseType: 'stream' });
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Length', response.headers['content-length']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: imageUrl });
    }
});

mediaRouter.all('/plex/audio/:plex_key', async (req, res) => {
    const { plex_key } = req.params;
    const mediaURL = await (new Plex()).loadMediaUrl(plex_key);
    try {
        //assume mp3, passthrough
        const response = await axios.get(mediaURL, { responseType: 'stream' });
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Length', response.headers['content-length']);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', `inline; filename="${plex_key}.mp3"`);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, mediaURL });
    }
});


mediaRouter.all('*', async (req, res) => {

    const { path, fileSize, mimeType } = findFile(req.path);
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
    res.setHeader('Last-Modified', new Date(Date.now()).toUTCString());
    res.setHeader('Content-Range', `bytes 0-${fileSize - 1}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${path.split('/').pop()}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            res.status(416).send('Requested range not satisfiable');
            return;
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(path, { start, end });

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);
        fileStream.pipe(res);
    } else {
        const fileStream = fs.createReadStream(path);
        res.status(200);
        fileStream.pipe(res);
    }
});

export default mediaRouter;