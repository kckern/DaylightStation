import axios from "./http.mjs";
import { buildCurl } from './httpUtils.mjs';
import { createLogger } from './logging/logger.js';

const haLogger = createLogger({ source: 'backend', app: 'homeassistant' });

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
            console.error(buildCurl({ method: 'POST', url, headers, data }));
            return null;
        }
        return response.data;
    } catch (error) {
    console.error("Request failed. You can try the following curl command:");
    console.error(buildCurl({ method: 'POST', url, headers, data }));
        return null;
    }
};


export const turnOnTVPlug = async () => {

    const data = { "entity_id": "switch.living_room_plug_tv" }
    const result = await HomeAPI('services/switch/turn_on',data);
    return result;


}

/**
 * Activate a Home Assistant scene
 * @param {string} sceneName - Scene name (with or without 'scene.' prefix)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export const activateScene = async (sceneName) => {
    if (!sceneName) {
        return { ok: false, error: 'Scene name is required' };
    }
    
    const entityId = sceneName.startsWith('scene.') 
        ? sceneName 
        : `scene.${sceneName}`;
    
    const data = { entity_id: entityId };
    
    try {
        haLogger.debug('homeassistant.scene.activating', { entityId });
        const result = await HomeAPI('services/scene/turn_on', data);
        
        if (result) {
            haLogger.info('homeassistant.scene.activated', { entityId });
            return { ok: true };
        } else {
            haLogger.warn('homeassistant.scene.failed', { entityId, reason: 'null_response' });
            return { ok: false, error: 'Home Assistant returned null response' };
        }
    } catch (error) {
        haLogger.error('homeassistant.scene.error', { entityId, error: error.message });
        return { ok: false, error: error.message };
    }
};

/**
 * Get current state of a Home Assistant entity
 * @param {string} entityId - Full entity ID (e.g., 'scene.garage_led_blue')
 * @returns {Promise<{state: string, last_changed: string, attributes: object} | null>}
 */
export const getEntityState = async (entityId) => {
    const { HOME_ASSISTANT_TOKEN, home_assistant } = process.env;
    if (!home_assistant || !HOME_ASSISTANT_TOKEN) {
        haLogger.warn('homeassistant.getEntityState.not_configured');
        return null;
    }
    
    const { host, port } = home_assistant;
    const url = `${host}:${port}/api/states/${entityId}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${HOME_ASSISTANT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        haLogger.debug('homeassistant.getEntityState.failed', { entityId, error: error.message });
        return null;
    }
};