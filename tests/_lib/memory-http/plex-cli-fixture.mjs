/** Fixed Plex CLI fixture: actual argv/parser/output over axios' existing adapter port. */
import axios from 'axios';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {wireRequest} from './http-wire.mjs';
const cli = fileURLToPath(new URL('../../../cli/plex.cli.mjs', import.meta.url));
const directories = JSON.parse(process.env.PLEX_FIXTURE_DIRECTORIES || '[]');
// Optional canned responses: { "<METHOD> <path[?query]>" | "<path[?query]>": { status?, body? } }.
// Paths are matched with the X-Plex-Token param removed; a query-less key matches any query.
const routes = JSON.parse(process.env.PLEX_FIXTURE_ROUTES || '{}');
const hits = [];
const calls = [];
const withoutToken = (url) => url.replace(/([?&])X-Plex-Token=[^&]*(&|$)/, (_m, lead, tail) => (tail ? lead : '')).replace(/[?&]$/, '');
function route(method, url) {
  const full = withoutToken(url);
  const bare = full.split('?')[0];
  for (const key of [`${method} ${full}`, full, `${method} ${bare}`, bare]) {
    if (Object.prototype.hasOwnProperty.call(routes, key)) return routes[key];
  }
  return null;
}
const app = { handle(req, res) {
  hits.push(req.url);
  res.setHeader('Content-Type', 'application/json');
  const canned = route(req.method, req.url);
  if (canned) {
    res.statusCode = canned.status || 200;
    return res.end(JSON.stringify(canned.body ?? {}));
  }
  if (req.url.startsWith('/library/sections?')) return res.end(JSON.stringify({ MediaContainer: { Directory: directories } }));
  if (req.url.startsWith('/library/sections/99/refresh')) { res.statusCode = 404; return res.end('{}'); }
  if (/^\/library\/sections\/\d+\/refresh/.test(req.url)) return res.end('{}');
  res.statusCode = 404;
  res.end('{}');
}};
axios.defaults.adapter = async (config) => {
  const url = new URL(config.url);
  const method = (config.method || 'get').toUpperCase();
  calls.push({ method, url: withoutToken(url.pathname + url.search), timeout: config.timeout });
  const reply = await wireRequest(app, method, url.pathname + url.search,
    { headers: config.headers?.toJSON?.() || config.headers || {} });
  const response = { data: reply.body, status: reply.status, statusText: reply.status === 200 ? 'OK' : 'Not Found',
    headers: reply.headers, config, request: null };
  if (!config.validateStatus || config.validateStatus(response.status)) return response;
  throw new axios.AxiosError('Request failed with status code ' + response.status,
    response.status >= 500 ? axios.AxiosError.ERR_BAD_RESPONSE : axios.AxiosError.ERR_BAD_REQUEST,
    config, null, response);
};
process.on('exit', () => {
  writeFileSync(process.env.PLEX_FIXTURE_HITS, JSON.stringify(hits));
  if (process.env.PLEX_FIXTURE_CALLS) writeFileSync(process.env.PLEX_FIXTURE_CALLS, JSON.stringify(calls));
});
process.argv = [process.argv[0], cli, ...process.argv.slice(2)];
await import(cli);
