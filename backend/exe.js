import fs from 'fs';
import util from 'util';
import express from 'express';
import { exec } from 'child_process';
import axios from 'axios';

const promiseExec = util.promisify(exec);
const exeRouter = express.Router();

// Helper class for Home Assistant
class HomeAssistant {
    constructor(host, port, token) {
        this.host = host;
        this.port = port;
        this.token = token;
    }

    async callService(entityId, service) {
        const url = `${this.host}:${this.port}/api/services/remote/${service}`;
        const headers = {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
        const data = { entity_id: entityId };
        const response = await axios.post(url, data, { headers });
        return response.data;
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

        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(url);
                if (response.status === 200) {
                    console.log('Kiosk is ready');
                    return true;
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

        const ready = await this.waitForKiosk();
        if (!ready) return { error: 'Kiosk not ready' };

        const queryString = new URLSearchParams(query).toString();
        const dst_url = `${this.daylightHost}${path}${queryString ? `?${queryString}` : ''}`;
        const url = `http://${this.host}:${this.port}/?cmd=loadUrl&password=${this.password}&url=${dst_url}`;
        await axios.get(url);

        const isLoaded = await this.waitForUrl(dst_url);
        if (isLoaded) {
            return { success: true };
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
        const url = `${this.daylightHost}/blank`;
        return await this.waitForUrl(url, 10);
    }
}

// Helper class for Tasker
class Tasker {
    constructor(host, port) {
        this.host = host;
        this.port = port;
    }

    async sendCommand(command) {
        const url = `http://${this.host}:${this.port}/${command}`;
        const response = await axios.get(url);
        return response.data;
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
        const service = req.params.state === 'on' ? 'turn_on' : 'turn_off';
        const result = await homeAssistant.callService('remote.shield_android_tv', service);
        res.json({ result });
    } catch (error) {
        console.error('Error in /tv/:state endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

exeRouter.get('/tv', async (req, res) => {
    try {
        const query = req.query || {};
        await homeAssistant.callService('remote.shield_android_tv', 'turn_on');
        const taskerResponse = await tasker.sendCommand('blank');
        const isBlank = await kiosk.waitForBlank()
        const kioskResponse = await kiosk.loadUrl('/tv', query);
        res.json({ status: 'ok', tasker: taskerResponse, kiosk: kioskResponse });
    } catch (error) {
        console.error('Error in /tv endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

exeRouter.post('/cmd', async (req, res) => {
    try {
        const { cmd } = req.body || req.query;
        const { hardware: { host, user, ssh_port = 22 } } = process.env;

        const keyPath = `/usr/src/app/host_private_key`;
        const knownPath = `/usr/src/app/known_hosts`;
        const knownIsEmpty = !fs.readFileSync(knownPath).toString().length;
        const base64Cmd = Buffer.from(cmd).toString('base64');
        const options = `${knownIsEmpty ? `-o StrictHostKeyChecking=no` : ""} -o UserKnownHostsFile=./known_hosts`;
        const sshCommand = `ssh ${options} -i ${keyPath} -p ${ssh_port} ${user}@${host} "echo ${base64Cmd} | base64 -d | bash"`;

        const stout = await executeCommand(sshCommand);
        res.json({ stout });
    } catch (error) {
        console.error('Error in /cmd endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

export default exeRouter;
