import { execSync } from 'child_process';
import { hostname } from 'os';
import yaml from 'js-yaml';
import axios from 'axios';
const CONTAINER = 'daylight-station';
function dockerRead(filePath) { return execSync(`sudo docker exec ${CONTAINER} sh -c 'cat ${filePath}'`, { encoding: 'utf-8' }); }
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
async function fetchJson(endpoint) {
    const url = `${baseUrl}/${endpoint}`;
    const sep = url.includes('?') ? '&' : '?';
    const res = await axios.get(`${url}${sep}X-Plex-Token=${token}`, { headers: { Accept: 'application/json' } });
    return res.data;
}
async function main() {
  const activities = await fetchJson('activities');
  console.log(JSON.stringify(activities?.MediaContainer?.Activity || [], null, 1));
}
main().catch(e => console.error(e.message));
