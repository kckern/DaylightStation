/**
 * One-time migration: old trigger config layout -> ECA layout with config/state split.
 *
 * Pure transform (migrateTriggerConfig) + a CLI that reads old files and writes new ones.
 * Old:  config/triggers/nfc/locations.yml, nfc/tags.yml, state/locations.yml
 * New:  config/triggers/sources.yml, bindings/nfc.yml, responses.yml, endpoints.yml
 *       history/triggers/nfc.observed.yml
 */
export function migrateTriggerConfig({ nfcLocations = {}, nfcTags = {}, stateLocations = {} } = {}) {
  const sources = {};
  for (const [loc, cfg] of Object.entries(nfcLocations)) {
    sources[loc] = { modality: 'nfc', ...cfg };
  }
  for (const [loc, cfg] of Object.entries(stateLocations)) {
    const key = sources[loc] ? `${loc}-state` : loc;
    sources[key] = { modality: 'state', location: loc, ...cfg };
  }

  const bindingsNfc = {};
  const observed = {};
  for (const [uid, entry] of Object.entries(nfcTags)) {
    const { scanned_at, ...curated } = entry || {};
    if (scanned_at) {
      observed[uid] = { first_seen: scanned_at, last_seen: scanned_at, count: 1 };
    }
    if (Object.keys(curated).length > 0) {
      bindingsNfc[uid] = curated;
    }
  }

  return { sources, bindingsNfc, observed, responses: {}, endpoints: {} };
}

export default migrateTriggerConfig;

// --- CLI (only runs when invoked directly) ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const [{ readFileSync, writeFileSync, mkdirSync, existsSync }, yaml, path] = await Promise.all([
    import('node:fs'), import('js-yaml').then((m) => m.default), import('node:path'),
  ]);
  const dataDir = process.argv[2];
  if (!dataDir) { console.error('usage: node scripts/migrate-trigger-config.mjs <dataDir>'); process.exit(1); }
  const rd = (p) => { const f = path.join(dataDir, p); return existsSync(f) ? yaml.load(readFileSync(f, 'utf8')) : undefined; };
  const wr = (p, obj) => {
    const f = path.join(dataDir, p);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, yaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
    console.log('wrote', p, `(${Object.keys(obj).length} keys)`);
  };
  const out = migrateTriggerConfig({
    nfcLocations: rd('household/config/triggers/nfc/locations.yml'),
    nfcTags: rd('household/config/triggers/nfc/tags.yml'),
    stateLocations: rd('household/config/triggers/state/locations.yml'),
  });
  wr('household/config/triggers/sources.yml', out.sources);
  wr('household/config/triggers/bindings/nfc.yml', out.bindingsNfc);
  wr('household/config/triggers/responses.yml', out.responses);
  wr('household/config/triggers/endpoints.yml', out.endpoints);
  wr('household/history/triggers/nfc.observed.yml', out.observed);
  console.log('migration complete');
}
