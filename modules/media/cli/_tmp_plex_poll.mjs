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
  while (true) {
    const activities = await fetchJson('activities');
    const acts = (activities?.MediaContainer?.Activity || []).filter(a => a.type.includes('library') || (a.title||'').includes('Khan'));
    const scanAct = acts.find(a => a.type === 'library.update.section');
    if (!scanAct) {
      console.log('SCAN_DONE library scan for section 17 no longer active');
      break;
    }
    console.log(`SCAN_PROGRESS ${scanAct.subtitle} ${scanAct.progress}%`);
    await new Promise(r => setTimeout(r, 300000));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
