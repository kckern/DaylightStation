// A tiny controllable search-stream server for journeys that need to see the
// "still arriving" sign: the app's real search request is redirected to it
// (a network route, no product code), and the test decides when each frame is
// sent. Frames use the real stream's event vocabulary.
//
//   const sse = await startSseServer();
//   await sse.install(page);                // redirect the search stream
//   sse.script(async (s) => { s.send({ event: 'pending', sources: ['plex'] }); await s.gate('go'); s.send(...); s.end(); });
//   ...type...; await expect(sign).toBeVisible(); sse.release('go'); await expect(sign).toBeHidden();
import http from 'node:http';

export async function startSseServer() {
  const gates = new Map();
  const requests = [];
  let scripted = async (s) => { s.send({ event: 'complete' }); s.end(); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(Object.fromEntries(url.searchParams));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const helpers = {
      params: Object.fromEntries(url.searchParams),
      send: (data) => res.write(`data: ${JSON.stringify(data)}\n\n`),
      end: () => res.end(),
      gate: (name) => new Promise((resolve) => {
        const entry = gates.get(name) ?? { open: false, waiters: [] };
        gates.set(name, entry);
        if (entry.open) resolve(); else entry.waiters.push(resolve);
      }),
    };
    req.on('close', () => { if (!res.writableEnded) res.end(); });
    Promise.resolve(scripted(helpers)).catch(() => res.end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    requests,
    script: (fn) => { scripted = fn; },
    release(name) {
      const entry = gates.get(name) ?? { open: false, waiters: [] };
      entry.open = true;
      gates.set(name, entry);
      for (const resolve of entry.waiters.splice(0)) resolve();
    },
    reset() { gates.clear(); requests.length = 0; },
    async install(page) {
      await page.route('**/api/v1/content/query/search/stream**', (route) => {
        const url = new URL(route.request().url());
        return route.continue({ url: `${origin}/stream${url.search}` });
      });
    },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/** A search result item shaped like the real stream's (a Plex leaf). */
export function streamItem({ id, title, type = 'movie', source = 'plex', thumbnail = null }) {
  return {
    itemId: {}, id, source, localId: id.split(':')[1], title, subtitle: null, type: null, thumbnail, imageUrl: null,
    description: null, metadata: { type, category: 'work' }, actions: null, itemType: 'leaf', children: [], childCount: 0, sortOrder: 0, mediaType: null, score: 1,
  };
}
