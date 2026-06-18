/**
 * Persistent recency log for ArtMode, living alongside the other media_memory
 * stores at `history/media_memory/art.yml`. Keyed `art:<id>` with
 * `{ lastShown, showCount }`, mirroring the plex/files convention so it reads the
 * same as the rest of media_memory.
 *
 * Loaded once into memory, written through on each `record()`. Read failures
 * other than "file missing" are logged and treated as an empty history (the
 * screensaver keeps running, just without tempering until the file is readable).
 *
 * @module adapters/content/art/artRecencyStore
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

export function createArtRecencyStore({ filePath, logger = console, now = () => new Date().toISOString() }) {
  let map = null;      // id → lastShown (ISO string)
  let counts = null;   // id → showCount
  let loading = null;

  async function load() {
    if (map) return map;
    if (loading) { await loading; return map; }
    loading = (async () => {
      const m = new Map();
      const c = new Map();
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const doc = yaml.load(raw) || {};
        for (const [k, v] of Object.entries(doc)) {
          const id = k.startsWith('art:') ? k.slice(4) : k;
          if (v?.lastShown) m.set(id, v.lastShown);
          c.set(id, Number(v?.showCount) || 0);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn?.('art.recency.read_failed', { error: err.message });
      }
      map = m;
      counts = c;
    })();
    await loading;
    loading = null;
    return map;
  }

  async function persist() {
    const doc = {};
    for (const [id, lastShown] of map.entries()) {
      doc[`art:${id}`] = { lastShown, showCount: counts.get(id) || 0 };
    }
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, yaml.dump(doc), 'utf-8');
    } catch (err) {
      logger.warn?.('art.recency.write_failed', { error: err.message });
    }
  }

  // Stamp the given ids as just-shown (bumping showCount) and write through.
  async function record(ids) {
    await load();
    const ts = now();
    for (const id of ids) {
      if (id == null) continue;
      map.set(id, ts);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    await persist();
  }

  return { load, record };
}

export default createArtRecencyStore;
