import fs from 'fs';
import util from 'util';
import path from 'path';
import express from 'express';
import { exec } from 'child_process';
import axios from '../lib/http.mjs';
import { loadFile, saveFile, householdLoadAuth, getCurrentHouseholdId } from '../lib/io.mjs';
import { broadcastToWebsockets, restartWebsocketServer } from './websocket.mjs';
import { createLogger } from '../lib/logging/logger.js';
import { serializeError } from '../lib/logging/utils.js';

const exeLogger = createLogger({ source: 'backend', app: 'exe' });

const promiseExec = util.promisify(exec);
const exeRouter = express.Router();

exeRouter.use(express.json({ limit: '50mb' }));
exeRouter.use(express.urlencoded({ limit: '50mb', extended: true }));

// Helper class for Home Assistant
// Expected Home Assistant entities and interfaces:
// Binary Sensors:
//   - binary_sensor.living_room_tv_state (TV power state for living room)
//   - binary_sensor.office_tv_state (TV power state for office)
// Scripts:
//   - script.living_room_tv_on (Turn on living room TV)
//   - script.living_room_tv_off (Turn off living room TV)
//   - script.living_room_tv_volume (Set living room TV volume)
//   - script.office_tv_on (Turn on office TV)
//   - script.office_tv_off (Turn off office TV)
//   - script.office_tv_volume (Set office TV volume)
// API Endpoints Used:
//   - /api/states/{entity_id} (GET) - Get entity state
//   - /api/services/{domain}/{service} (POST) - Call service
//   - /api/services/script/turn_on (POST) - Run script
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
            exeLogger.error('exe.homeassistant.fetch.failed', { url, error: serializeError(error) });
            throw error;
        }


    }

    async getSensorData(entityId) {
        //eg sensor.living_room_tv_plug_power
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
            exeLogger.debug('exe.homeassistant.waitForState', { entityId, state, desiredState });
            if (state === desiredState) {
                exeLogger.info('exe.homeassistant.stateReached', { entityId, desiredState });
                return Math.floor((Date.now() - startTime) / 1000);
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second interval
        }
        return Math.floor((Date.now() - startTime) / 1000);
    }

    async turnOnTV(location = 'living_room') {
        const startTime = Date.now();
        let { state } = await this.getSensorData(`binary_sensor.${location}_tv_state`);
        if (state === 'on') {
            await this.runScript(`script.${location}_tv_volume`);
            return Math.floor((Date.now() - startTime) / 1000);
        }
        await this.runScript(`script.${location}_tv_on`);
        await this.waitForState(`binary_sensor.${location}_tv_state`, 'on');
        return Math.floor((Date.now() - startTime) / 1000);
    }

    async turnOffTV(location = 'living_room') {
        const startTime = Date.now();
        let { state } = await this.getSensorData(`binary_sensor.${location}_tv_state`);
        if (state === 'off') return Math.floor((Date.now() - startTime) / 1000);
        await this.runScript(`script.${location}_tv_off`);
        await this.waitForState(`binary_sensor.${location}_tv_state`, 'off');
        return Math.floor((Date.now() - startTime) / 1000);
    }
    async toggleTV(location = 'living_room') {
        const { state } = await this.getEntityState(`binary_sensor.${location}_tv_state`);
        if (state === 'on') {
            await this.turnOffTV(location);
        } else {
            await this.turnOnTV(location);
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
                    exeLogger.info('exe.kiosk.ready', { secondsTaken });
                    return Math.max(secondsTaken, 1);
                }
            } catch (error) {
                exeLogger.debug('exe.kiosk.waitAttempt', { attempt: attempts + 1, error: error.message });
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second interval
        }

        exeLogger.error('exe.kiosk.timeout', { maxAttempts, timeoutSeconds: 30 });
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
        exeLogger.debug('exe.kiosk.loadUrl', { isLoaded, dst_url });
        const secondsToLoadUrl = Math.floor((Date.now() - startTime) / 1000);
        if (isLoaded) {
            return { success: true, secondsToLoadKiosk, secondsToLoadUrl };
        }

        exeLogger.debug('exe.kiosk.loadUrl.retry', { attempt });
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
                exeLogger.debug('exe.kiosk.waitForUrl.attempt', { attempt: tries + 1, error: error.message });
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
        exeLogger.error('exe.exec.failed', { error: serializeError(error) });
        throw error;
    }
}

// Get Home Assistant auth from household config with env fallback
const getHomeAssistantAuth = () => {
    const hid = getCurrentHouseholdId();
    const auth = householdLoadAuth(hid, 'homeassistant') || {};
    return {
        host: auth.host || process.env.home_assistant?.host,
        port: auth.port || process.env.home_assistant?.port,
        token: auth.token || process.env.HOME_ASSISTANT_TOKEN
    };
};

// Get Fully Kiosk auth from household config with env fallback
const getFullyKioskAuth = () => {
    const hid = getCurrentHouseholdId();
    const auth = householdLoadAuth(hid, 'fullykiosk') || {};
    return {
        password: auth.password || process.env.FULLY_KIOSK_PASSWORD
    };
};

// Initialize helpers with lazy auth loading
const haAuth = getHomeAssistantAuth();
const kioskAuth = getFullyKioskAuth();

const homeAssistant = new HomeAssistant(
    haAuth.host,
    haAuth.port,
    haAuth.token
);

const kiosk = new Kiosk(
    process.env.tv?.host,
    process.env.tv?.port_kiosk,
    kioskAuth.password,
    process.env.tv?.daylight_host
);

const tasker = new Tasker(
    process.env.tv.host,
    process.env.tv.port_tasker
);

// Routes
exeRouter.get('/tv/:state(on|off|toggle)', async (req, res) => {
    try {
        exeLogger.info('exe.tv.request', { state: req.params.state });
        let result;
        if (req.params.state === 'toggle') result = await homeAssistant.toggleTV();
        if (req.params.state === 'on') result = await homeAssistant.turnOnTV();
        if (req.params.state === 'off') result = await homeAssistant.turnOffTV();
        res.json({ result });
    } catch (error) {
        exeLogger.error('exe.tv.failed', { state: req.params.state, error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

exeRouter.get('/office_tv/:state(on|off|toggle)', async (req, res) => {
    try {
        exeLogger.info('exe.officeTv.request', { state: req.params.state });
        let result;
        if (req.params.state === 'toggle') result = await homeAssistant.toggleTV('office');
        if (req.params.state === 'on') result = await homeAssistant.turnOnTV('office');
        if (req.params.state === 'off') result = await homeAssistant.turnOffTV('office');
        res.json({ result });
    } catch (error) {
        exeLogger.error('exe.officeTv.failed', { state: req.params.state, error: serializeError(error) });
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
        exeLogger.error('exe.tv.loadFailed', { error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

async function execmd(cmd) {
    const { cmd: { host, user, port, known_hosts, private_key } } = process.env;

    // Bulletproof known_hosts path resolution
    let resolvedKnownHosts = known_hosts || './known_hosts';
    
    // Always resolve to absolute path
    if (!path.isAbsolute(resolvedKnownHosts)) {
        resolvedKnownHosts = path.resolve(process.cwd(), resolvedKnownHosts);
    }
    
    exeLogger.debug('exe.execmd.knownHosts', { path: resolvedKnownHosts });

    // Ensure directory exists
    let knownIsEmpty = true;
    try {
        const dir = path.dirname(resolvedKnownHosts);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Create or check known_hosts file
        if (!fs.existsSync(resolvedKnownHosts)) {
            fs.writeFileSync(resolvedKnownHosts, '', { mode: 0o600 });
            exeLogger.info('exe.execmd.knownHostsCreated', { path: resolvedKnownHosts });
            knownIsEmpty = true;
        } else {
            const content = fs.readFileSync(resolvedKnownHosts, 'utf8');
            knownIsEmpty = !content || content.trim().length === 0;
            exeLogger.debug('exe.execmd.knownHostsExists', { path: resolvedKnownHosts, isEmpty: knownIsEmpty });
        }
    } catch (err) {
        exeLogger.error('exe.execmd.knownHostsError', { error: serializeError(err) });
        // Continue anyway - SSH will use StrictHostKeyChecking=no
        knownIsEmpty = true;
    }

    const base64Cmd = Buffer.from(cmd).toString('base64');
    const sshOptions = [
        knownIsEmpty ? '-o StrictHostKeyChecking=no' : '',
        `-o UserKnownHostsFile=${resolvedKnownHosts}`,
        `-i ${private_key}`,
        `-p ${port}`
    ].filter(Boolean).join(' ');
    
    const sshCommand = `ssh ${sshOptions} ${user}@${host} "echo ${base64Cmd} | base64 -d | bash"`;
    exeLogger.info('exe.execmd.executing', { host, user });
    
    try {
        return await executeCommand(sshCommand);
    } catch (err) {
        exeLogger.error('exe.execmd.failed', { host, user, error: serializeError(err) });
        throw err;
    }
}

exeRouter.get('/vol/:level', handleVolumeRequest);
exeRouter.get('/volume/:level', handleVolumeRequest);

async function handleVolumeRequest(req, res) {
    const { level } = req.params;
    const cycleLevels = [70, 50, 30, 20, 10, 0];
    const hid = process.env.household_id || 'default';
    const volumeStateFile = `households/${hid}/history/hardware/volLevel`;
    try {
        let stout;
        const beforeState = loadFile(volumeStateFile);

        // Load current state
        let volumeState = loadFile(volumeStateFile);
        if (typeof volumeState !== 'object' || !volumeState || typeof volumeState.volume !== 'number') {
            volumeState = { volume: 70, muted: false };
        }
        let { volume, muted } = volumeState;
        
        // Handle mute operations first
        if (level === 'mute') {
            saveFile(volumeStateFile, { volume, muted: true });
            stout = await execmd(`amixer set Master mute`);
        } else if (level === 'unmute') {
            saveFile(volumeStateFile, { volume, muted: false });
            stout = await execmd(`amixer set Master unmute`);
        } else if (level === 'togglemute') {
            if (muted) {
                saveFile(volumeStateFile, { volume, muted: false });
                stout = await execmd(`amixer set Master unmute`);
                stout = await execmd(`amixer set Master ${volume}%`);
            } else {
                saveFile(volumeStateFile, { volume, muted: true });
                stout = await execmd(`amixer set Master mute`);
            }
        } else {
            // For all other operations, unmute first if currently muted
            if (muted) {
                await execmd(`amixer set Master unmute`);
                muted = false;
            }
            const increment = 12;
            if (["-","+"].includes(level)) {
                let nextLevel = level === '+' ? Math.min(volume + increment, 100) : Math.max(volume - increment, 0);
                saveFile(volumeStateFile, { volume: nextLevel, muted });
                stout = await execmd(`amixer set Master ${nextLevel}%`);
            } else if (parseInt(level) === 0) {
                saveFile(volumeStateFile, { volume: 0, muted: true });
                stout = await execmd(`amixer set Master mute`);
            } else if (!isNaN(parseInt(level))) {
                saveFile(volumeStateFile, { volume: parseInt(level), muted });
                stout = await execmd(`amixer set Master ${level}%`);
            } else if (level === 'cycle') {
                let nextIndex = (cycleLevels.indexOf(volume) + 1) % cycleLevels.length;
                let nextLevel = cycleLevels[nextIndex];
                saveFile(volumeStateFile, { volume: nextLevel, muted });
                stout = await execmd(`amixer set Master ${nextLevel}%`);
            }
        }
        const afterState = loadFile(volumeStateFile);
        res.json({ stout, beforeState, afterState });
    } catch (error) {
        exeLogger.error('exe.volume.failed', { level, error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error', body: req.body, query: req.query });
    }
}

exeRouter.get('/audio/:device', async (req, res) => {
    const { device } = req.params;
    try {
        const cmd = `wpctl set-default $(wpctl status | grep '${device}' | sed 's/.*│[[:space:]]*\\([0-9]*\\)\\..*/\\1/')`;
        const stout = await execmd(cmd);
        
        res.json({ 
            device,
            command: cmd,
            stout 
        });
    } catch (error) {
        exeLogger.error('exe.audio.failed', { device, error: serializeError(error) });
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
        exeLogger.error('exe.ws.broadcast.failed', { error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// WebSocket restart endpoint
exeRouter.post("/ws/restart", async (req, res) => {
    try {
        exeLogger.info('exe.ws.restart.requested');
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
        exeLogger.error('exe.ws.restart.failed', { error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});



exeRouter.post('/cmd', async (req, res) => {
    const { cmd } = { ...req.body, ...req.query, ...req.params };
    try {
        const stout = await execmd(cmd);
        res.json({ stout });
    } catch (error) {
        exeLogger.error('exe.cmd.failed', { error: serializeError(error) });
        res.status(500).json({ error: error.message || 'Internal Server Error', body: req.body, query: req.query });
    }
});

export default exeRouter;
