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
export const processListItem = async (item) => {
    item.action = item.action?.toLowerCase() || item.action;
    const inputs = typeof item.input === 'string' ? item.input.split(/[;]/).map(i => i.trim()) : [];
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
    if(item.shuffle) {inputObject['shuffle'] = item.shuffle; delete item.shuffle;}
    if (item.playable) { inputObject['playable'] = item.playable; delete item.playable;}
    item.input = inputObject;
    const actionKey = item.action || 'play';
    item = { ...item, [actionKey]: item.input };
    delete item.input;
    delete item.action;
    return item;
}