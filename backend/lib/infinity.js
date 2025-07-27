import axios from 'axios';
import { saveFile, saveImage } from './io.mjs';

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

    if(!tableId) {
        console.log('loadTable: No tableId provided');
        return [];
    }
    const token = await authInfinity();
    if (!token) {
        console.log('loadTable: No auth token available');
        return [];
    }
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
    //console.log(fetched_data.map(item => item.values.map(val => val.attribute)));
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
        console.log('loadTable error:', e.message);
        console.log('loadTable error response:', e.response?.data);
        return [];
    }
}
const processTable = (tableData, folders) => {
    console.log(`processTable called with tableData type: ${typeof tableData}, isArray: ${Array.isArray(tableData)}`);
    if (!Array.isArray(tableData)) {
        console.error('processTable received non-array tableData:', tableData);
        return [];
    }
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
        const {name:folderName,color:folderColor} = folders.find(folder => folder.id === item.folder_id) || {name:null, color:null};
        processedItem.folder = folderName || item.folder_id;
        if (folderColor) processedItem.folder_color = folderColor;
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
    const { INFINITY_WORKSPACE } = process.env;
    const url = `https://app.startinfinity.com/api/v2/workspaces/${INFINITY_WORKSPACE}/boards/${tableId}/items/${itemId}`;
    const data = {
        "values": [
            {
                "attribute_id": key,
                "data": val
            }
        ]
    };
    try {
        const response = await axios.put(url, data, {
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (e) {
        console.error("Error updating item:", e.message);
        console.error("Response data:", e.response?.data);
        console.error("Curl equivalent:");
        console.error(`curl -X PUT '${url}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '${JSON.stringify(data)}'`);
        return false;
    }
};

const loadData = async (name,req) => {
    console.log(`Loading data for: ${name}`);
    console.log(`Table ID: ${process.env.infinity[name]}`);
    
    let data = await loadTable(process.env.infinity[name]);
    console.log(`loadTable returned:`, typeof data, Array.isArray(data), data?.length || 'no length property');
    
    if (!data || !Array.isArray(data)) {
        console.error(`Failed to load table data for ${name}, or data is not an array:`, data);
        return [];
    }
    
    console.log(`About to call saveImages with ${data.length} items`);
    data = await saveImages(data, name);
    saveFile(`config/${name}`, data);
    return data;
}

const saveImages = async (items, table_name) => {
    console.log(`saveImages called with items type: ${typeof items}, isArray: ${Array.isArray(items)}, length: ${items?.length || 'no length'}`);
    
    if (!items || !Array.isArray(items)) {
        console.error(`saveImages received invalid items for table ${table_name}:`, items);
        return [];
    }
    const hasImages = items.filter(item => item.image);
    if (!hasImages.length) return items;
    const host = process.env.host || "";
    for (let i = 0; i < items.length; i++) {
        if (items[i].image) {
            await saveImage(items[i].image, table_name, items[i].uid);
            delete items[i].image;
            items[i].image = `${host}/media/img/${table_name}/${items[i].uid}`;
        }
    }
    return checkForDupeImages(items);
}

const checkForDupeImages = async (items) => {
    if (!items || !Array.isArray(items)) {
        console.error('checkForDupeImages received invalid items:', items);
        return [];
    }
    const itemsWithImages = items.filter(item => item.image);
    items.forEach(item => {
        if (!item.image) {
            const match = itemsWithImages.find(i => 
                i.uid !== item.uid && 
                (i.input?.toLowerCase().trim() === item.input?.toLowerCase().trim() || 
                 i.label?.toLowerCase().trim() === item.label?.toLowerCase().trim())
            );
            if (match) item.image = match.image;
        }
    });
    return items;
};


export default { loadTable, saveItem, updateItem, loadData, keys};