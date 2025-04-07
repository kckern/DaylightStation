import e from 'express';
import { loadFile, saveFile, saveImage } from '../lib/io.mjs';
import moment from 'moment';


const DaylightHostPath = () => {
    const { DAYLIGHT_HOST } = process.env;
    if (!DAYLIGHT_HOST) return false;
    return DAYLIGHT_HOST;
};

//
// Keep the structure and variable names, but re-implement the internals.
//
export const navProcess = async (host) => {
    // Load data
    const data = await loadFile('nav');
    if (!data) return false;
    const processedData = await Promise.all(data.map(async (item) => {
        item.action = item.action?.toLowerCase() || item.action;
        const inputs = item.input.split(/[;|]/).map(i => i.trim());
        let inputObject = {};
        for (const input of inputs) {
            const [key, value] = input.split(':').map(i => i.trim());
            if (key && value) {
            if (value.includes(',')) {
                inputObject[key] = value.split(',').map(v => v.trim());
            } else {
                inputObject[key] = value;
            }
            } else if (key && key.includes('version')) {
            inputObject['version'] = key.replace('version ', '').trim();
            } else if (key) {
            inputObject[key] = true;
            } else {
            inputObject[input] = true;
            }
        }
        item.input = inputObject;
        const actionKey = item.action || 'play';
        item = { ...item, [actionKey]: item.input };
        delete item.input;
        delete item.action;

        if (item.image) {
            await saveImage(item.image, 'navimgs', item.uid);
            const protocol = /localhost/.test(host) ? 'http' : 'https';
            item.image = `${protocol}://${host}/media/img/navimgs/${item.uid}`;
        }

        return item;
    }));

    
    const folders = [...new Set(processedData.map(item => item.folder))];
    const processedFolders = {};
    for(const folder of folders) {
        const folderData = processedData.filter(item => item.folder === folder).map(item => {
            delete item.folder;
            return item;
        });
        processedFolders[folder] = folderData;
    }

    saveFile('nav', processedFolders);
    return true;
};
