import axios from "axios";

const HomeAPI = async (path, data) => {
    const { HOME_ASSISTANT_TOKEN, home_assistant: { host, port } } = process.env;
    const url = `${host}:${port}/api/${path}`;
    const headers = {
        'Authorization': `Bearer ${HOME_ASSISTANT_TOKEN}`,
        'Content-Type': 'application/json'
    };
    const curlCommand = `curl -X POST ${url} -H "Authorization: Bearer ${HOME_ASSISTANT_TOKEN}" -H "Content-Type: application/json" -d '${JSON.stringify(data)}'`;

    try {
        const response = await axios.post(url, data, { headers });
        if (response.status !== 200) {
            console.error("Request failed. You can try the following curl command:");
            console.error(curlCommand);
            return null;
        }
        return response.data;
    } catch (error) {
        console.error("Request failed. You can try the following curl command:");
        console.error(curlCommand);
        return null;
    }
};


export const turnOnTVPlug = async () => {

    const data = { "entity_id": "switch.living_room_plug_tv" }
    const result = await HomeAPI('services/switch/turn_on',data);
    return result;


}