import { execSync } from 'child_process';
import yaml from 'js-yaml';
import axios from 'axios';
import { hostname } from 'os';

const CONTAINER = 'daylight-station';
function dockerRead(filePath) {
    try {
        return execSync(`sudo docker exec ${CONTAINER} sh -c 'cat ${filePath}'`, { encoding: 'utf-8' });
    } catch { return null; }
}
const authRaw = dockerRead('data/household/auth/plex.yml');
const token = (yaml.load(authRaw) || {}).token;
const servicesRaw = dockerRead('data/system/config/services.yml');
const plexHosts = (yaml.load(servicesRaw) || {}).plex || {};
const host = plexHosts[hostname()] || plexHosts['kckern-server'] || plexHosts.docker;

const id = process.argv[2] || '416589';
const url = `${host.replace(/\/$/, '')}/playlists/${id}/items?X-Plex-Token=${token}`;
const { data } = await axios.get(url, { headers: { Accept: 'application/json' } });
const items = data?.MediaContainer?.Metadata || [];
console.log(JSON.stringify(items.map(t => ({
    ratingKey: t.ratingKey,
    title: t.title,
    artist: t.grandparentTitle || t.originalTitle,
    album: t.parentTitle,
    year: t.year,
    duration: t.duration
})), null, 1));
