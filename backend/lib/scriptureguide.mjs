import { saveFile } from './io.mjs';
import axios from './http.mjs';
import {lookupReference} from 'scripture-guide';
const volumes = {
    "ot": 1,
    "nt": 23146,
    "bom": 31103,
    "dc": 37707,
    "pgp": 41361,
    "lof": 41996
};

const findVolume = (verse_id) => {
    const vols = Object.entries(volumes);
    const [volume] = vols.reduce((prev, curr) => {
        return verse_id >= curr[1] ? curr : prev;
    });
    return volume;
};

const baseUrl = `https://raw.scripture.guide`;
const defaultVersion = 'LDS';

const getScripture = async (req) => {
    const { version = defaultVersion, ref = 'Gen 1' } = req.query || {};
    const {data} = await axios.get(`${baseUrl}/${version}/${ref.replace(' ', '+')}`);
    if(version === 'redc') {
        const {data:altData} = await axios.get(`${baseUrl}/${defaultVersion}/${ref.replace(' ', '+')}`);
        const keys = Object.keys(altData);
        for(const key of keys) {
            data[key]['headings'] = {
                ...altData[key]['headings'], 
                ...data[key
            ]['headings']};
            if(!Object.keys(data[key]['headings']).length) delete data[key]['headings'];
        }
    }
    const firstVerseId = Object.keys(data)[0];
    const volume = findVolume(firstVerseId);
    saveFile(`content/scripture/${volume}/${version}/${firstVerseId}`, Object.values(data));
    return data;
}

export default getScripture