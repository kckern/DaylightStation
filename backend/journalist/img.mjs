
import fs from 'fs';
import { getPhotoUrl } from './lib/telegram.mjs';
import fetch from '../lib/httpFetch.mjs'; 
import dotenv from 'dotenv';
dotenv.config();


export default async (req, res) => {

    process.env.TELEGRAM_JOURNALIST_BOT_TOKEN = process.env.TELEGRAM_NUTRIBOT_TOKEN;

    //load image from tmp
    const file_id = req.query.file_id;
    if(!file_id) return res.status(400).send('No file_id found');
    const url = await getPhotoUrl(file_id); 

    //load into buffer
    const fetchedImage = await fetch(url);
    const arrayBuffer = await fetchedImage.arrayBuffer();

    //return image
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(Buffer.from(arrayBuffer));
}