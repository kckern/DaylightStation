import axios from 'axios';
import { loadFile, saveFile, saveImage } from './io.mjs';
import { navProcess } from '../jobs/nav.mjs';

const keys = Object.keys(process.env.infinity);

const authInfinity = async () => {
    const { INFINITY_DEV  } = process.env;
   return INFINITY_DEV;
}

const loadFolders = async (tableId) => {
    const token = await authInfinity();
    if (!token) return false;
    const url = `https://app.startinfinity.com/api/v2/workspaces/${process.env.INFINITY_WORKSPACE}/boards/${tableId}/folders`;
    const response = await axios.get(url, {
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    });
    return response.data?.data
};

const loadTable = async (tableId , data = [], after = "") => {

    const { INFINITY_WORKSPACE } = process.env;

    if(!tableId) return false;
    const token = await authInfinity();
    if (!token) return false;
    try{
        
    let url = `https://app.startinfinity.com/api/v2/workspaces/${INFINITY_WORKSPACE}/boards/${tableId}/items?limit=100&expand%5B%5D=values.attribute&sort_direction=asc`;
    if (after) url = url + "&after=" + after;
    const response = await axios.get(url, {
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    });
    let fetched_data = response?.data?.data;
    if (data.length) fetched_data = [...data, ...fetched_data];
    if (response?.data.has_more) {
        after = response?.data.after;
        return loadTable(tableId, fetched_data, after);
    }

    //sort by sort_order
    fetched_data = fetched_data.sort((a, b) => {
        const sortOrderA = parseFloat(a.sort_order) || 0;
        const sortOrderB = parseFloat(b.sort_order) || 0;
        if (sortOrderA < sortOrderB) return -1;
        if (sortOrderA > sortOrderB) return 1;
        return 0;
    });

    const folders = await loadFolders(tableId);

    return processTable(fetched_data, folders);

    

    }catch(e){
        console.log(e.message);
        console.log(e.response?.data);
        return false;
    }
}
const processTable = (tableData, folders) => {
    const items = tableData.map(item => {
        const processedItem = item.values.reduce((acc, val) => {
            let key = val.attribute.name.toLowerCase().split(' ').join('_');
            let value;
            if (Array.isArray(val?.data)) {
                value = val.data.map(id => loadLabel(id, val.attribute)).join(", ");
            } else {
                value = val?.data;
            }
            acc[key] = value;
            return acc;
        }, {});
        processedItem.uid = item.id;
        const folderName = folders.find(folder => folder.id === item.folder_id)?.name;
        processedItem.folder = folderName || item.folder_id;
        return processedItem;
    });
    return items;
}
const loadLabel = (id, attribute) => {
    if(typeof id !== "string") return id?.link || id;
    const index = {};
    attribute.settings.labels?.forEach(label => {
        index[label.id] = label.name;
    });
    return index[id];
}

const saveItem = async (tableId, folderId, dictionary) => {
    const token = await authInfinity();
    if (!token) return false;
    const url = `https://app.startinfinity.com/api/v2/workspaces/${INFINITY_WORKSPACE}/boards/${tableId}/items`;
    const data = {
        "folder_id": folderId,
        "values": []
    };
    for (const [key, value] of Object.entries(dictionary)) {
        data.values.push({
            "attribute_id": key,
            "data": value
        });
    }
    const response = await axios.post(url, data, {
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    });
    return response.data;
};
const updateItem = async (tableId, itemId, key, val) => {
    const token = await authInfinity();
    if (!token) return false;
    const url = `https://app.startinfinity.com/api/v2/workspaces/${INFINITY_WORKSPACE}/boards/${tableId}/items/${itemId}`;
    const data = {
        "values": [
            {
                "attribute_id": key,
                "data": val
            }
        ]
    };
    const response = await axios.put(url, data, {
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    });
    return response.data;
};

const loadData = async (name,req) => {
    let data = await loadTable(process.env.infinity[name]);
    const host = req.headers.host;
    data = await saveImages(host, data, name);
    saveFile(name, data);
    if (name === "nav") await navProcess(host) //todo, need a better way to handle one off jobs
    return data;
}

const saveImages = async (host, items, table_name) => {
    const hasImages = items.filter(item => item.image);
    if (!hasImages.length) return items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].image) {
            await saveImage(items[i].image, table_name, items[i].uid);
            const protocol = /localhost/.test(host) ? 'http' : 'https';
            delete items[i].image;
            items[i].image = `${protocol}://${host}/media/img/${table_name}/${items[i].uid}`;
        }
    }
    return items;
}


export default { loadTable, saveItem, updateItem, loadData, keys};