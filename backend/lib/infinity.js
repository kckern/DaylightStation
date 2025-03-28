import axios from 'axios';
import { loadFile, saveFile } from './io.mjs';

const keys = ['program', 'videomenu', 'watchlist', 'entropy', 'youtube'];

const authInfinity = async () => {
    const { INFINITY_DEV, INFINITY_CLI,INFINITY_CLIS  } = process.env;
   return INFINITY_DEV;
    const {refresh} = loadFile('_tmp/infinity');
    if (!refresh) return false;
    const options = {
        grant_type: 'refresh_token',
        client_id: INFINITY_CLI,
        client_secret: INFINITY_CLIS,
        refresh_token: refresh
    };
    try {
        const response = await axios.post('https://app.startinfinity.com/oauth/token', options);
        console.log(response.data); 
        const { access_token, refresh_token } = response.data;
        console.log({ access_token, refresh_token });
        if (!access_token) return false;
        if (refresh_token) saveFile('_tmp/infinity', refresh_token);
        return access_token;
    } catch (e) {
        console.log(e.message);
        console.log(e.response.data);
        console.log(options);
        return false;
    }
}
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
    let fetched_data = response.data.data;
    if (data.length) fetched_data = [...data, ...fetched_data];
    if (response.data.has_more) {
        after = response.data.after;
        return loadTable(tableId, fetched_data, after);
    }
    return processTable(fetched_data);

    }catch(e){
        console.log(e.message);
        console.log(e.response.data);
        return false;
    }
}
const processTable = (tableData) => {
    const items = tableData.map(item => {
        const processedItem = item.values.reduce((acc, val) => {
            let key = val.attribute.name.toLowerCase().split(' ').join('_');
            let value;
            if (Array.isArray(val.data)) {
                value = val.data.map(id => loadLabel(id, val.attribute)).join(", ");
            } else {
                value = val.data;
            }
            acc[key] = value;
            return acc;
        }, {});
        processedItem.uid = item.id;
        return processedItem;
    });
    return items;
}
const loadLabel = (id, attribute) => {
    const index = {};
    attribute.settings.labels.forEach(label => {
        index[label.id] = label.name;
    });
    return index[id];
}
const processKey = (val) => {
    return val.attribute.name.toLowerCase().replace(" ", "_");
};
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

const loadData = async (name) => {
    const data = await loadTable(process.env.infinity[name]);
    saveFile(name, data);
    return data;
}

export default { loadTable, saveItem, updateItem, loadData, keys};