import { saveFile } from './io.mjs';
import axios from 'axios';
import {parse} from 'node-html-parser'; 
import fs from 'fs';



export default async function harvestLDSGC(req) {
    const thisYear = new Date().getFullYear();
    const thisMonth = new Date().getMonth() + 1;
    const gcMonth = (thisMonth >= 10 || thisMonth <= 3) ? '10' : '04';
    const gcYear = (thisMonth >= 4 && thisMonth <= 9) ? thisYear : thisYear - 1;
    const { year = gcYear, month = gcMonth } = req.query;
    const baseUrl = `https://www.churchofjesuschrist.org`;
    const url = `${baseUrl}/study/general-conference/${year}/${month}?lang=eng`;
    const {data} = await axios.get(url);
    const indexHtml = parse(data);
    const selector = `.doc-map li`;
    const items = indexHtml.querySelectorAll(selector).map(item => {
        const url = baseUrl + item.querySelector('a')?.getAttribute('href');
        const api = item.querySelector('a')?.getAttribute('href').replace(/\/study\//, '').replace(/\?lang=eng/, '');
        const num = parseInt(url?.split('/').pop().replace(/[^0-9]/g, ''));
        const speaker = item.querySelector('h6')?.innerText;
        const title = item.querySelector('h4')?.innerText;
        return { num, url, api, speaker, title };
    }).filter(item => item.url && item.speaker && !/general officers|auditing|session/i.test(item.title));


    for(const item of items) {

        const apiBase = `https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=/`;
        const apiUrl = apiBase + item.api;
        const {data} = await axios.get(apiUrl, { headers: { 'Accept': 'application/json' } });
        const mediaUrl = (data.meta.video?.[0]?.mediaUrl || data.meta.audio?.[0]?.mediaUrl) ?? null;
        //const title = data.meta.title;
        const html = parse(data.content.body);
        const title = html.querySelector('h1')?.innerText;
        const speaker = html.querySelector('.byline')?.innerText.trim().replace(/\n/g, ' • ');
        const content = html.querySelector('.body-block')?.querySelectorAll('p, h2').map(el => {
            if (el.tagName === 'H2') {
            return `## ${el.innerText}`;
            }
            return el.innerText;
        });
        const saveMe = {mediaUrl,title, speaker, content}
        //return data.meta;
        saveFile('ldsgc/' + item.num, saveMe);

    }
    saveFile('ldsgc/index', items);
    return items;
}

