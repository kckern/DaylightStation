import e from 'express';
import { loadFile, saveFile, saveImage } from '../lib/io.mjs';
import moment from 'moment';

//
// Keep the structure and variable names, but re-implement the internals.
//
export const navProcess = async (job_id) => {
    // Load data
    const data = await loadFile('nav');
    if (!data) return false;
    const processedData = await Promise.all(data.map(async (item) => {
        const inputs = item.input.split(/[;|]/).map(i => i.trim());
        let inputObject = {};
        for (const input of inputs) {
            const [key, value] = input.split(':').map(i => i.trim());
            if (key && value) {
                inputObject[key] = value;
            } else if (key) {
                inputObject[key] = true;
            } else {
                inputObject[input] = true;
            }
        }
        item.input = inputObject;

        if (item.image) {
            await saveImㅍage(item.image, 'navimgs', item.uid);
            item.image = `navimgs/${item.uid}.jpg`;
        }

        return item;
    }));

    
    
    

    saveFile('nav', processedData);
    return true;
};
