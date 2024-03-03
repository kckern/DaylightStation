import fs from 'fs';
import yaml from 'js-yaml';
import {decode} from 'html-entities';
import smartquotes from 'smartquotes';

import dotenv from 'dotenv';
dotenv.config();


const loadFile = (path) => {
    path = path.replace(process.env.path.data, '').replace(/^[.\/]+/, '').replace(/\.yaml$/, '') + '.yaml';
    const fileExists = fs.existsSync(`${process.env.path.data}/${path}`);    
    if(!fileExists) return false;
    const fileData = fs.readFileSync(`${process.env.path.data}/${path}`, 'utf8').toString().trim();
    try{
        const object = yaml.load(fileData);
        console.log({fileData, object});
        return object;
    }catch(e){
        return fileData
    }
}

function removeCircularReferences(data){
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(data, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    }));
}

const mkDirIfNotExists= (path) =>{
    const pathWithoutFilename = path.split('/').slice(0,-1).join('/');
    const dirs = pathWithoutFilename.split('/');
    let currentPath = process.env.path.data;
    dirs.forEach(dir => {
        currentPath = `${currentPath}/${dir}`;
        if (!fs.existsSync(currentPath)) {
            fs.mkdirSync(currentPath);
        }
    });
}

const saveFile = (path, data) => {
    path = path.replace(process.env.path.data, '').replace(/^[.\/]+/, '');
    //mkdir if not exists
    mkDirIfNotExists(path);
    //add yaml if it doesnt end with .yaml
    const yamlFile = path.endsWith('.yaml') ? path : `${path}.yaml`;
    data = JSON.parse(JSON.stringify(removeCircularReferences(data)));
    fs.writeFileSync(`${process.env.path.data}/${yamlFile}`, yaml.dump(data), 'utf8');

    return true;
}

const sanitize = (string) => {

    string = smartquotes(decode(string));
    const allowedChars = /[a-zA-Z0-9\s\-_\uAC00-\uD7A3\(\)\[\]\{\}\'\"\&”“‘’<@>.,;!?]/;
    string = string.replace(/\s+/g, ' ').trim();
    return string.split('').filter(char => char.match(allowedChars)).join('');


}


export { loadFile, saveFile, sanitize };