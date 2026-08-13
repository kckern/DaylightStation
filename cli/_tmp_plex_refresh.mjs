import { execSync } from 'child_process';
import { hostname } from 'os';
import yaml from 'js-yaml';
import axios from 'axios';

const CONTAINER = 'daylight-station';
function dockerRead(filePath) {
    return execSync(`sudo docker exec ${CONTAINER} sh -c 'cat ${filePath}'`, { encoding: 'utf-8' });
}
function loadConfig() {
    const authRaw = dockerRead('data/household/auth/plex.yml');
    const token = (yaml.load(authRaw) || {}).token;
    const servicesRaw = dockerRead('data/system/config/services.yml');
    const plexHosts = (yaml.load(servicesRaw) || {}).plex || {};
    const host = plexHosts[hostname()] || plexHosts['kckern-server'] || plexHosts.docker;
    return { token, host };
}
const { token, host } = loadConfig();
const baseUrl = host.replace(/\/$/, '');
async function plexGet(endpoint) {
    const url = `${baseUrl}/${endpoint}`;
    const sep = url.includes('?') ? '&' : '?';
    const res = await axios.get(`${url}${sep}X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } });
    return res.data;
}
async function plexPut(endpoint) {
    const url = `${baseUrl}/${endpoint}`;
    const sep = url.includes('?') ? '&' : '?';
    const res = await axios.put(`${url}${sep}X-Plex-Token=${token}`, null, { headers: { Accept: 'application/json' } });
    return res.status;
}

const SECTION_ID = '17';
const SHOW_ID = '685550';

async function main() {
  console.log('1) Scanning section 17 (Lectures) for new/changed files...');
  await plexGet(`library/sections/${SECTION_ID}/refresh`);
  console.log('   scan triggered.');

  console.log('2) Forcing deep metadata refresh on Khan Academy show (685550)...');
  const status = await plexPut(`library/metadata/${SHOW_ID}/refresh`);
  console.log('   refresh status:', status);
}
main().catch(e => { console.error(e.response?.status, e.response?.data || e.message); process.exit(1); });
