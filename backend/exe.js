import { exec } from 'child_process';
import fs from 'fs';

async function executeCommand(sshCommand) {
    try {
        const { stdout, stderr } =  exec(sshCommand);
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        return stdout;
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
        const { hardware: { host, user, port=22}, DOCKER_HOST_SSH_KEY } = process.env;
        console.log('Environment variables:', { host, user, port, DOCKER_HOST_SSH_KEY });
        const keyPath = `${process.env.HOME}/.ssh/docker_host_ssh_key`;
        console.log('Key path:', keyPath);
        if (!fs.existsSync(keyPath)) {
            console.log('Key path does not exist');
            //check if folder exists
            if (!fs.existsSync(`${process.env.HOME}/.ssh`)) {
                console.log('SSH folder does not exist, creating...');
                fs.mkdirSync(`${process.env.HOME}/.ssh`);
            }
            console.log('Writing SSH key to file...');
            fs.writeFileSync(keyPath, DOCKER_HOST_SSH_KEY, { mode: 0o600 });
        }
        console.log('Writing command to file...');
        fs.writeFileSync('/tmp/cmd.sh', cmd, { mode: 0o700 });
        const options = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';
        const sshCommand = `ssh ${options} -i ${keyPath} -p ${port} ${user}@${host} 'sh /tmp/cmd.sh'`;    
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


