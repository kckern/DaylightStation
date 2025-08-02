import fs from 'fs';
import util from 'util';
import express from 'express';
import { exec } from 'child_process';
import axios from 'axios';
import { loadFile, saveFile } from './lib/io.mjs';
import { broadcastToWebsockets, restartWebsocketServer } from './websocket.js';

const promiseExec = util.promisify(exec);
const exeRouter = express.Router();

exeRouter.use(express.json());

// Helper class for Home Assistant
class HomeAssistant {
    constructor(host, port, token) {
        this.host = host;
        this.port = port;
        this.token = token;
    }

    async fetch(path, method = 'GET', data = null) {

        const url = `${this.host}:${this.port}${path}`;
        const headers = {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
        const options = {
            method,
            url,
            headers,
        };
        if (data) {
            options.data = data;
        }
        try {
            const response = await axios(options);
            return response.data;
        } catch (error) {
            console.error(`Error fetching ${url}:`, error.message || error);
            throw error;
        }


    }

    async getSensorData(entityId) {
        //eg sensor.living_room_plug_tv_power
        const path = `/api/states/${entityId}`;
        return await this.fetch(path, 'GET');
    }

    async callService(entityId, service) {
        const [domain, ...rest] = entityId.split('.');
        const path = `/api/services/${domain}/${service}`;
        const data = { entity_id: entityId };
        return await this.fetch(path, 'POST', data);
    }

    async getEntityState(entityId) {
        const path = `/api/states/${entityId}`;
        const data = { entity_id: entityId };
        return await this.fetch(path, 'GET', data);
    }

    async runScript(scriptEntityId) {
        const path = `/api/services/script/turn_on`;
        const data = { entity_id: scriptEntityId };
        return await this.fetch(path, 'POST', data);
    }

    async waitForState(entityId, desiredState, timeout = 30) {
        const startTime = Date.now();
        let { state } = await this.getSensorData(entityId);
        while (state !== desiredState && (Date.now() - startTime) / 1000 < timeout) {
            const updatedSensor = await this.getSensorData(entityId);
            state = updatedSensor.state;
            console.log(`${entityId} state:`, state);
            if (state === desiredState) {
                console.log(`${entityId} is now in the desired state: ${desiredState}.`);
                return Math.floor((Date.now() - startTime) / 1000);
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second interval
        }
        return Math.floor((Date.now() - startTime) / 1000);
    }

    async turnOnTV() {
        const startTime = Date.now();
        let { state } = await this.getSensorData('binary_sensor.living_room_tv_state');
        if (state === 'on') {
            await this.runScript('script.living_room_tv_volume');
            return Math.floor((Date.now() - startTime) / 1000);
        }
        await this.runScript('script.living_room_tv_on');
        await this.waitForState('binary_sensor.living_room_tv_state', 'on');
        return Math.floor((Date.now() - startTime) / 1000);
    }

    async turnOffTV() {
        const startTime = Date.now();
        let { state } = await this.getSensorData('binary_sensor.living_room_tv_state');
        if (state === 'off') return Math.floor((Date.now() - startTime) / 1000);
        await this.runScript('script.living_room_tv_off');
        await this.waitForState('binary_sensor.living_room_tv_state', 'off');
        return Math.floor((Date.now() - startTime) / 1000);
    }
    async toggleTV() {
        const { state } = await this.getEntityState('binary_sensor.living_room_tv_state');
        if (state === 'on') {
            await this.turnOffTV();
        } else {
            await this.turnOnTV();
        }
    }


}

// Helper class for Fully Kiosk Browser
class Kiosk {
    constructor(host, port, password, daylightHost) {
        this.host = host;
        this.port = port;
        this.password = password;
        this.daylightHost = daylightHost;
    }
    async waitForKiosk() {
        const url = `http://${this.host}:${this.port}/home?password=${this.password}`;
        const maxAttempts = 15; // 30 seconds max with 2-second intervals
        let attempts = 0;
        const startTime = Date.now();

        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(url);
                if (response.status === 200) {
                    const secondsTaken = Math.floor((Date.now() - startTime) / 1000);
                    console.log(`Kiosk is ready (took ${secondsTaken} seconds)`);
                    return Math.max(secondsTaken, 1);
                }
            } catch (error) {
                console.log(`Attempt ${attempts + 1} failed: ${error.message || error}`);
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second interval
        }

        console.error('Kiosk did not become ready within the timeout period');
        return false;
    }

    async loadUrl(path, query = {}, attempt = 1) {
        if (attempt > 10) {
            return { error: 'Failed to load URL after 10 attempts' };
        }

        const secondsToLoadKiosk = await this.waitForKiosk();
        if (!secondsToLoadKiosk) return { error: 'Kiosk not ready' };

        const queryString = new URLSearchParams(query).toString();
        const dst_url = `${this.daylightHost}${path}${queryString ? `?${queryString}` : ''}`;
        const encodedUrl = encodeURIComponent(dst_url);
        const startTime = Date.now();
        const url = `http://${this.host}:${this.port}/?cmd=loadUrl&password=${this.password}&url=${encodedUrl}`;
        await axios.get(url);
        const isLoaded = await this.waitForUrl(dst_url);
        console.log({isLoaded, dst_url});
        const secondsToLoadUrl = Math.floor((Date.now() - startTime) / 1000);
        if (isLoaded) {
            return { success: true, secondsToLoadKiosk, secondsToLoadUrl };
        }

        console.log(`Attempt ${attempt} failed. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.loadUrl(path, query, attempt + 1);
    }

    async waitForUrl(needle, attempts = null) {
        const haystack_url = `http://${this.host}:${this.port}/home?password=${this.password}`;
        const testString = needle.replace(/[ +]/g, '%20');
        let tries = 0;

        while (attempts === null || tries < attempts) {
            try {
                const { data: haystack } = await axios.get(haystack_url);
                if (haystack.includes(testString)) {
                    return true;
                }
            } catch (error) {
                console.error(`Attempt ${tries + 1} failed: ${error.message || error}`);
            }

            tries++;
            if (attempts === null || tries < attempts) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second interval
            }
        }

        return false;
    }

    async waitForBlank() {
        const startTime = Date.now();
        const url = `${this.daylightHost}/blank`;
        await this.waitForUrl(url, 10);
        return Math.floor((Date.now() - startTime) / 1000);
    }
}

// Helper class for Tasker
class Tasker {
    constructor(host, port) {
        this.host = host;
        this.port = port;
    }

    async sendCommand(command, start = null, attempt = 1) {
        if(attempt > 10) return false;
        start = start || Date.now();
        const url = `http://${this.host}:${this.port}/${command}`;
        const response = await axios.get(url);
        const isOK = /OK/.test(response.data);
        if(!isOK) await this.sendCommand(command, start, attempt + 1);
        return  Math.floor((Date.now() - start) / 1000);
    }
}






// Helper function for executing SSH commands
async function executeCommand(sshCommand) {
    try {
        const { stdout } = await promiseExec(sshCommand);
        return stdout.trim().split('\n');
    } catch (error) {
        console.error(`exec error: ${error}`);
        throw error;
    }
}

// Initialize helpers
const homeAssistant = new HomeAssistant(
    process.env.home_assistant.host,
    process.env.home_assistant.port,
    process.env.HOME_ASSISTANT_TOKEN
);

const kiosk = new Kiosk(
    process.env.tv.host,
    process.env.tv.port_kiosk,
    process.env.FULLY_KIOSK_PASSWORD,
    process.env.tv.daylight_host
);

const tasker = new Tasker(
    process.env.tv.host,
    process.env.tv.port_tasker
);

// Routes
exeRouter.get('/tv/:state(on|off|toggle)', async (req, res) => {
    try {

        console.log('param:', req.params.state);
        let result;
        if (req.params.state === 'toggle') result = await homeAssistant.toggleTV();
        if (req.params.state === 'on') result = await homeAssistant.turnOnTV();
        if (req.params.state === 'off') result = await homeAssistant.turnOffTV();
        res.json({ result });

    } catch (error) {
        console.error('Error in /tv/:state endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});


exeRouter.get('/tv', async (req, res) => {
    try {
        const secondsToTurnOnTV = await homeAssistant.turnOnTV();
        const query = req.query || {};
        const secondsToOpenKiosk = await tasker.sendCommand('blank');
        const secondsToPrepareKiosk = await kiosk.waitForBlank()
        const {success, secondsToLoadKiosk, secondsToLoadUrl} = await kiosk.loadUrl('/tv', query);
        res.json({ status: 'ok', secondsToTurnOnTV, secondsToOpenKiosk, secondsToPrepareKiosk, secondsToLoadKiosk, secondsToLoadUrl });
    } catch (error) {
        console.error('Error in /tv endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

async function execmd(cmd) {
    const { cmd: { host, user, port, known_hosts, private_key } } = process.env;
    const knownIsEmpty = !fs.readFileSync(known_hosts).toString().length;
    const base64Cmd = Buffer.from(cmd).toString('base64');
    const options = `${knownIsEmpty ? `-o StrictHostKeyChecking=no` : ""} -o UserKnownHostsFile=./known_hosts`;
    const sshCommand = `ssh ${options} -i ${private_key} -p ${port} ${user}@${host} "echo ${base64Cmd} | base64 -d | bash"`;
    return await executeCommand(sshCommand);
}

exeRouter.get('/vol/:level', async (req, res) => {
    const { level } = req.params;
    const cycleLevels = [70, 50, 30, 20, 10, 0];
    const volumeStateFile = 'history/hardware/volLevel';
    const muteStateFile = 'history/hardware/muteState';
    try {
        let stout;
        if (level === 'cycle') {
            let currentLevel = parseInt(loadFile(volumeStateFile)) || 70;
            let nextIndex = (cycleLevels.indexOf(currentLevel) + 1) % cycleLevels.length;
            let nextLevel = cycleLevels[nextIndex];
            saveFile(nextLevel.toString(), volumeStateFile);
            stout = await execmd(`amixer set Master ${nextLevel}%`);
        } else if (["-","+"].includes(level)) {
            let currentLevel = parseInt(loadFile(volumeStateFile)) || 70;
            let nextLevel = level === '+' ? Math.min(currentLevel + 20, 100) : Math.max(currentLevel - 20, 0);
            saveFile(nextLevel.toString(), volumeStateFile);
            stout = await execmd(`amixer set Master ${nextLevel}%`);
        } else if (level === 'mute') {
            saveFile('true', muteStateFile);
            stout = await execmd(`amixer set Master mute`);
        } else if (level === 'unmute') {
            saveFile('false', muteStateFile);
            stout = await execmd(`amixer set Master unmute`);
        } else if (level === 'togglemute') {
            let isMuted = loadFile(muteStateFile) === 'true';
            if (isMuted) {
                saveFile('false', muteStateFile);
                stout = await execmd(`amixer set Master unmute`);
            } else {
                saveFile('true', muteStateFile);
                stout = await execmd(`amixer set Master mute`);
            }
        } else {
            if (parseInt(level) === 0) {
                saveFile('0', volumeStateFile);
                saveFile('true', muteStateFile);
                stout = await execmd(`amixer set Master mute`);
            } else {
                saveFile(level, volumeStateFile);
                saveFile('false', muteStateFile);
                stout = await execmd(`amixer set Master ${level}%`);
            }
        }
        res.json({ stout });
    } catch (error) {
        console.error('Error in /vol/:level endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error', body: req.body, query: req.query });
    }
});

exeRouter.get('/audio/:device', async (req, res) => {
    const { device } = req.params;
    try {
        const cmd = `wpctl set-default \\$(wpctl status | grep '${device}' | sed 's/.*│[[:space:]]*\\([0-9]*\\)\\..*/\\1/')`;
        const stout = await execmd(cmd);
        
        res.json({ 
            device,
            command: cmd,
            stout 
        });
    } catch (error) {
        console.error('Error in /audio/:device endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error', body: req.body, query: req.query });
    }
});



// ALL /ws - send raw payload (body for POST, query for GET, params for others)
exeRouter.all("/ws", async (req, res) => {
    try {
        // Prefer body, then query, then params
        const payload = Object.keys(req.body || {}).length
            ? req.body
            : (Object.keys(req.query || {}).length
                ? req.query
                : (req.params || {}));
        
        const message = {
            timestamp: new Date().toISOString(),
            ...payload
        };
        
        broadcastToWebsockets(message);
        
        res.json({ 
            status: 'payload broadcasted', 
            message,
            description: 'Frontend will receive the raw payload data'
        });
    } catch (error) {
        console.error('Error in /ws endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// WebSocket restart endpoint
exeRouter.post("/ws/restart", async (req, res) => {
    try {
        console.log('WebSocket restart requested...');
        const success = restartWebsocketServer();
        
        if (success) {
            res.json({ 
                status: 'WebSocket server restarted successfully',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to restart WebSocket server',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Error in /ws/restart endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});



exeRouter.post('/cmd', async (req, res) => {
    const { cmd } = { ...req.body, ...req.query, ...req.params };
    try {
        const stout = await execmd(cmd);
        res.json({ stout });
    } catch (error) {
        console.error('Error in /cmd endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error', body: req.body, query: req.query });
    }
});

export default exeRouter;
