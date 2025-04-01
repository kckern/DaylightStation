import axios from 'axios';
import express from 'express';
import fs from 'fs';
import {Plex} from './lib/plex.mjs';
const mediaRouter = express.Router();
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
    const fileSize = firstMatch? fs.statSync(firstMatch).size : fs.statSync(notFound).size;
    if(!firstMatch) return {path: notFound, fileSize, mimeType: 'audio/mpeg'};

    const mimeType = extention === 'mp3' ? 'audio/mpeg' : 'video/mp4';

    return {path: firstMatch, fileSize, mimeType};
}
mediaRouter.get('/img/*', async (req, res) => {
    const exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
    const img = req.params[0]; // Capture the full path after /img/
    const baseDir = `${process.env.path.img}`;
    const filePathWithoutExt = `${baseDir}/${img}`;
    const ext = exts.find(e => fs.existsSync(`${filePathWithoutExt}.${e}`));
    const filePath = ext ? `${filePathWithoutExt}.${ext}` : `${baseDir}/notfound.png`;
    const mimeType = ext ? `image/${ext}` : 'image/png';
    const statusCode = ext ? 200 : 404;
    res.status(statusCode).set({
        'Content-Type': mimeType,
        'Content-Length': fs.statSync(filePath).size,
        'Cache-Control': 'public, max-age=31536000',
        'Expires': new Date(Date.now() + 31536000000).toUTCString(),
        'Content-Disposition': `inline; filename="${img}.${ext || 'notfound.png'}"`,
        'Access-Control-Allow-Origin': '*'
    });
    return fs.createReadStream(filePath).pipe(res);
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

mediaRouter.all('/plex/info/:plex_key/:action?', async (req, res) => {
    const { plex_key, action } = req.params;
    const shuffle = action === 'shuffle';
    const plexInfo = await (new Plex()).loadPlayableItemFromKey(plex_key, shuffle);
    try {
        res.json(plexInfo);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: plexUrl });
    }
});

mediaRouter.all('/plex/list/:plex_key/:action?', async (req, res) => {
    const { plex_key, action } = req.params;
    const shuffle = action === 'shuffle';
    const plexList = await (new Plex()).loadChildrenFromKey(plex_key, shuffle);
    try {
        res.json(plexList);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching from Plex server', message: error.message, plexUrl: plexUrl });
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