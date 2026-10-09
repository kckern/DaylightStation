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
const BASELINE_UPDATED_AT = 1784845709;

async function main() {
  while (true) {
    const showData = await fetchJson('library/metadata/685550/children');
    const s1 = showData.MediaContainer.Metadata.find(s => s.index === 1);
    const epData = await fetchJson(`library/metadata/${s1.ratingKey}/children`);
    const first = epData.MediaContainer.Metadata.sort((a,b)=>a.index-b.index)[0];
    const activities = await fetchJson('activities');
    const acts = activities?.MediaContainer?.Activity || [];
    const khanActs = acts.filter(a => (a.subtitle||'').includes('Khan') || (a.title||'').includes('Khan'));

    if (first.updatedAt !== BASELINE_UPDATED_AT) {
      console.log('CHANGED', JSON.stringify({title: first.title, summary: (first.summary||'').slice(0,60), updatedAt: first.updatedAt}));
      break;
    }
    console.log(`UNCHANGED khan_activities=${khanActs.length} total_activities=${acts.length}`);
    await new Promise(r => setTimeout(r, 300000));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
