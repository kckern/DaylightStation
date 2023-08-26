const fs = require('fs');

const loadFile = (path) => {
    path = path.replace(process.env.dataPath, '').replace(/^[.\/]+/, '').replace(/\.json$/, '') + '.json';
    const fileExists = fs.existsSync(`${process.env.dataPath}/${path}`);    
    if(!fileExists) return false;
    const fileData = fs.readFileSync(`${process.env.dataPath}/${path}`, 'utf8');
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

const saveFile = (path, data) => {
    path = path.replace(process.env.dataPath, '').replace(/^[.\/]+/, '');

    //TODO: update data to remove any circular references that would cause JSON.stringify to fail
    if(typeof data !== 'string') data = JSON.stringify(removeCircularReferences(data),null,2);
    fs.writeFileSync(`${process.env.dataPath}/${path}`, data, 'utf8');
    return true;
}


module.exports = { loadFile, saveFile };