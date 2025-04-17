import fs from 'fs';
import yaml from 'js-yaml';
import {decode} from 'html-entities';
import smartquotes from 'smartquotes';
import axios from 'axios';


export const saveImage = async (url, folder, uid) => {
    if (!url) return false;
    const path = `${process.env.path.img}/${folder}/${uid}`;
    const pathWithoutFilename = path.split('/').slice(0, -1).join('/');

    // Ensure the folder exists
    if (!fs.existsSync(pathWithoutFilename)) {
        fs.mkdirSync(pathWithoutFilename, { recursive: true });
    }

    // Check if file already exists
    const alreadyExists = fs.existsSync(path + '.jpg');
    if (alreadyExists) {
        const stats = fs.statSync(path + '.jpg');
        const fileAgeInMs = Date.now() - stats.mtimeMs;
        const oneDayInMs = 24 * 60 * 60 * 1000;
        if (fileAgeInMs < oneDayInMs) {
            //console.log(`Image already exists and is less than 24 hours old: ${path}.jpg`);
            return true;
        }
    }

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });

        const filePath = `${path}.jpg`; // Assuming the image is a .jpg
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error(`Failed to save image from ${url}:`, error);
        return false;
    }
};

export const loadRandom = (folder) => {
    const path = `${process.env.path.data}/${folder}`;
    if (!fs.existsSync(path)) {
        console.error(`Folder does not exist: ${path}`);
        return false;
    }

    const files = fs.readdirSync(path).filter(file => file.endsWith('.yaml'));
    if (files.length === 0) {
        console.error(`No YAML files found in folder: ${path}`);
        return false;
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = `${path}/${randomFile}`;
    const fileData = fs.readFileSync(filePath, 'utf8').toString().trim();

    try {
        const object = yaml.load(fileData);
        return object;
    } catch (e) {
        console.error(`Failed to parse YAML file: ${filePath}`, e);
        return false;
    }
};



const loadFile = (path) => {
    path = path.replace(process.env.path.data, '').replace(/^[.\/]+/, '').replace(/\.yaml$/, '') + '.yaml';
    const fileExists = fs.existsSync(`${process.env.path.data}/${path}`);    
    if(!fileExists) return false;
    const fileData = fs.readFileSync(`${process.env.path.data}/${path}`, 'utf8').toString().trim();
    try{
        const object = yaml.load(fileData);
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
    if(typeof path !== 'string') return false;
    path = path?.replace(process.env.path.data, '').replace(/^[.\/]+/, '');
    //mkdir if not exists
    mkDirIfNotExists(path);
    console.log(data);
    //add yaml if it doesnt end with .yaml
    const yamlFile = path.endsWith('.yaml') ? path : `${path}.yaml`;
    data = JSON.parse(JSON.stringify(removeCircularReferences(data)));
    const dst = `${process.env.path.data}/${yamlFile}`;
    fs.writeFileSync(`${dst}`, yaml.dump(data), 'utf8');

    //console.log(`Saved file to ${dst}`);

    return true;
}

const sanitize = (string) => {

    string = smartquotes(decode(string));
    const allowedChars = /[a-zA-Z0-9\s\-_\uAC00-\uD7A3\(\)\[\]\{\}\'\"\&”“‘’<@>.,;!?]/;
    string = string.replace(/\s+/g, ' ').trim();
    return string.split('').filter(char => char.match(allowedChars)).join('');


}


export { loadFile, saveFile, sanitize };