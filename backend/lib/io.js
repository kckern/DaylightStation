import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();


const loadFile = (path) => {
    path = path.replace(process.env.dataPath, '').replace(/^[.\/]+/, '').replace(/\.json$/, '') + '.json';
    const fileExists = fs.existsSync(`${process.env.path.data}/${path}`);    
    if(!fileExists) return false;
    const fileData = fs.readFileSync(`${process.env.path.data}/${path}`, 'utf8');
    try{
        return JSON.parse(fileData);
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


    //TODO: update data to remove any circular references that would cause JSON.stringify to fail
    if(typeof data !== 'string') data = JSON.stringify(removeCircularReferences(data),null,2);
    fs.writeFileSync(`${process.env.path.data}/${path}`, data, 'utf8');
    return true;
}


export { loadFile, saveFile}