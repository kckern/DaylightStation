import fs from 'fs';
import yaml from 'js-yaml';
import {decode} from 'html-entities';
import smartquotes from 'smartquotes';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';

const ioLogger = createLogger({
    source: 'backend',
    app: 'io'
});

class FlowSequence extends Array {}

const FlowSequenceType = new yaml.Type('tag:yaml.org,2002:seq', {
    kind: 'sequence',
    instanceOf: FlowSequence,
    represent: (sequence) => sequence,
    defaultStyle: 'flow'
});

const CUSTOM_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([FlowSequenceType]);

// Per-path write queues to avoid concurrent save collisions
const SAVE_QUEUES = globalThis.__daylightSaveQueues || new Map();
globalThis.__daylightSaveQueues = SAVE_QUEUES;

const isNullOrInteger = (value) => value === null || (typeof value === 'number' && Number.isInteger(value));

const markFlowSequences = (value) => {
    if (Array.isArray(value)) {
        const processed = value.map((item) => markFlowSequences(item));
        const shouldFlow = processed.length > 0 && processed.every(isNullOrInteger);
        if (shouldFlow) {
            const flowSequence = new FlowSequence();
            processed.forEach((item) => flowSequence.push(item));
            return flowSequence;
        }
        return processed;
    }

    if (value && typeof value === 'object') {
        Object.keys(value).forEach((key) => {
            value[key] = markFlowSequences(value[key]);
        });
    }

    return value;
};


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
        ioLogger.error('io.saveImage.failed', { url, message: error?.shortMessage || error.message });
        return false;
    }
};

export const loadRandom = (folder) => {
    const path = `${process.env.path.data}/${folder}`;
    if (!fs.existsSync(path)) {
        ioLogger.error('io.loadRandom.folderMissing', { path });
        return false;
    }

    const files = fs.readdirSync(path).filter(file => 
        file.endsWith('.yaml') && !file.startsWith('._')
    );
    if (files.length === 0) {
        ioLogger.warn('io.loadRandom.noYamlFiles', { path });
        return false;
    }

    const randomFile = files[Math.floor(Math.random() * files.length)];
    const filePath = `${path}/${randomFile}`;
    const fileData = fs.readFileSync(filePath, 'utf8').toString().trim();

    try {
        const object = yaml.load(fileData);
        return object;
    } catch (e) {
        ioLogger.error('io.loadRandom.parseError', { filePath, message: e?.message || e });
        return false;
    }
};


const loadFile = (path) => {
    path = path.replace(process.env.path.data, '').replace(/^[.\/]+/, '').replace(/\.(yaml|yml)$/, '');
    
    // Skip macOS resource fork files
    const filename = path.split('/').pop();
    if (filename && filename.startsWith('._')) {
       // console.warn(`Skipping macOS resource fork file: ${path}`);
        return null;
    }
    
    // Try .yaml first, then .yml
    const yamlPath = `${process.env.path.data}/${path}.yaml`;
    const ymlPath = `${process.env.path.data}/${path}.yml`;
    let fileToLoad = null;

    if (fs.existsSync(yamlPath)) {
        fileToLoad = yamlPath;
    } else if (fs.existsSync(ymlPath)) {
        fileToLoad = ymlPath;
    } else {
        ioLogger.warn('io.loadFile.missingFile', { yamlPath, ymlPath });
        //touch file
        saveFile(yamlPath, {});
        return null;
    }
    let fileData = fs.readFileSync(fileToLoad, 'utf8').toString().trim();
    // Remove null bytes and other problematic characters
    fileData = fileData.replace(/\u0000/g, '');

    try {
        const object = yaml.load(fileData);
        //if {} then return null
        if (object && Object.keys(object).length === 0) return null;
        return object || null;
    } catch (e) {
        ioLogger.error('io.loadFile.parseError', { fileToLoad, message: e?.message || e });
        return fileData || null;
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

const getQueue = (key) => {
    if (!SAVE_QUEUES.has(key)) {
        SAVE_QUEUES.set(key, { writing: false, pending: [] });
    }
    return SAVE_QUEUES.get(key);
};

const processQueue = (key) => {
    const queue = SAVE_QUEUES.get(key);
    if (!queue || queue.writing) return;
    const job = queue.pending.shift();
    if (!job) {
        SAVE_QUEUES.delete(key);
        return;
    }

    queue.writing = true;
    try {
        mkDirIfNotExists(job.normalizedPath);
        const processed = markFlowSequences(job.data);
        const dst = `${process.env.path.data}/${job.yamlFile}`;
        const yamlString = yaml.dump(processed, {
            schema: CUSTOM_YAML_SCHEMA,
            lineWidth: -1
        });
        fs.writeFileSync(dst, yamlString, 'utf8');
    } catch (err) {
        ioLogger.error('io.saveFile.queueWriteFailed', { yamlFile: job.yamlFile, message: err?.message || err });
    } finally {
        queue.writing = false;
        if (queue.pending.length === 0) {
            SAVE_QUEUES.delete(key);
        } else {
            processQueue(key);
        }
    }
};

const saveFile = (path, data) => {
    if (typeof path !== 'string') return false;
    const normalizedPath = path?.replace(process.env.path.data, '').replace(/^[.\/]+/, '');
    const yamlFile = normalizedPath.endsWith('.yaml') ? normalizedPath : `${normalizedPath}.yaml`;

    const queue = getQueue(yamlFile);
    // Clone eagerly so callers can mutate after queuing without affecting the write
    const cloned = JSON.parse(JSON.stringify(removeCircularReferences(data)));

    queue.pending.push({ normalizedPath, yamlFile, data: cloned });
    processQueue(yamlFile);
    return true;
}

const sanitize = (string) => {

    string = smartquotes(decode(string));
    const allowedChars = /[a-zA-Z0-9\s\-_\uAC00-\uD7A3\(\)\[\]\{\}\'\"\&”“‘’<@>.,;!?]/;
    string = string.replace(/\s+/g, ' ').trim();
    return string.split('').filter(char => char.match(allowedChars)).join('');


}


export { loadFile, saveFile, sanitize };