
import fs from 'fs';
import util from 'util';
import { exec } from 'child_process';
const promiseExec = util.promisify(exec);


async function executeCommand(sshCommand) {
    try {
        const { stdout } =  await promiseExec(sshCommand);
        return stdout.trim().split('\n');
    } catch (error) {
        console.error(`exec error: ${error}`);
        throw error;
    }
}

export default async function exe(req,res) {
    try{
        console.log('Starting exe function');
        const { cmd } = req.body || req.query;
        console.log('Command received:', cmd);
        const { hardware: { host, user, ssh_port=22} } = process.env;
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
    }
    catch (error) {
        const msg = error.message || error;
        console.log('Error occurred:', error);
        res.json({ error: msg });
    }
    return true;
}


