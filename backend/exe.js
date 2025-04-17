import fs from 'fs';
import util from 'util';
import express from 'express';
import { exec } from 'child_process';
import axios from 'axios';

const promiseExec = util.promisify(exec);
const exeRouter = express.Router();

async function executeCommand(sshCommand) {
    try {
        const { stdout } = await promiseExec(sshCommand);
        return stdout.trim().split('\n');
    } catch (error) {
        console.error(`exec error: ${error}`);
        throw error;
    }
}

exeRouter.get('/tv', async (req, res) => {
    try {
        const query = req.query || {};
        const queryString = new URLSearchParams(query).toString();
        const { tv: { host, port_tasker, port_kiosk, daylight_host }, FULLY_KIOSK_PASSWORD } = process.env;

        // Step 1: Use Tasker to turn on the TV and open Fully Kiosk Browser
        const taskerResponse = await axios.get(`http://${host}:${port_tasker}/blank`);
        console.log('Tasker response:', taskerResponse.data);

        // Step 2: Use Fully Kiosk Browser to open the URL
        const fullyUrl = `http://${host}:${port_kiosk}/?cmd=loadUrl&password=${FULLY_KIOSK_PASSWORD}&url=${daylight_host}/tv${queryString ? `?${queryString}` : ''}`;
        console.log('Fully Kiosk URL:', fullyUrl);

        let fullyResponse;
        const timeout = 30000; // 30 seconds timeout
        const interval = 1000; // 1 second retry interval
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                fullyResponse = await axios.get(fullyUrl);
                break; // Exit loop if request is successful
            } catch (error) {
                console.log('Retrying Fully Kiosk request...');
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        }

        if (!fullyResponse) {
            throw new Error(`Timeout: Unable to reach Fully Kiosk at ${host}:${port_kiosk}`);
        }

        // Extract contents of <div class='content'>...</div>
        const results = (fullyResponse.data.match(/<p class='(?:success|error)'>.*?<\/p>/g) || [])
            .map(match => match.replace(/<\/?p.*?>/g, ''));

        res.json({ status: "ok", tasker: taskerResponse.data, fullyUrl, results });
    } catch (error) {
        console.error('Error in /tv endpoint:', error.message || error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});


exeRouter.post('/cmd', async (req, res) => {
    try {
        console.log('Starting /cmd endpoint');
        const { cmd } = req.body || req.query;
        console.log('Command received:', cmd);

        const { hardware: { host, user, ssh_port = 22 } } = process.env;
        console.log('Environment variables:', { host, user, ssh_port });

        const keyPath = `/usr/src/app/host_private_key`;
        const knownPath = `/usr/src/app/known_hosts`;
        const knownIsEmpty = !fs.readFileSync(knownPath).toString().length;
        const base64Cmd = Buffer.from(cmd).toString('base64');
        const options = `${knownIsEmpty ? `-o StrictHostKeyChecking=no` : ""} -o UserKnownHostsFile=./known_hosts`;
        const sshCommand = `ssh ${options} -i ${keyPath} -p ${ssh_port} ${user}@${host} "echo ${base64Cmd} | base64 -d | bash"`;
        console.log('Executing SSH command:', sshCommand);

        const stout = await executeCommand(sshCommand);
        console.log('Command output:', stout);
        res.json({ stout });
    } catch (error) {
        const msg = error.message || error;
        console.log('Error occurred:', error);
        res.json({ error: msg });
    }
});

export default exeRouter;
