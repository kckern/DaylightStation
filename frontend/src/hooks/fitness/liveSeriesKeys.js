/**
 * liveSeriesKeys — the inverse of PersistenceManager's mapSeriesKeysForPersist.
 *
 * A saved session stores series under compact on-disk keys (`kid-a:rings`,
 * `bike:7138:rpm`, `device:D:heart-rate`, zone letters). A resumed session
 * must put them back under the live keys the recorders write (`user:kid-a:
 * rings_total`, `device:7138:rpm`, …). Left on-disk-keyed, the live keys start
 * empty after a reload and — both mapping to the same saved key — overwrite the
 * restored history at the next save.
 */
const PERSON_METRIC = { hr: 'heart_rate', zone: 'zone_id', beats: 'heart_beats', rings: 'rings_total', coins: 'rings_total' };
const ZONE_WORDS = { r: 'rest', c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' };
const snake = (s) => String(s).replace(/-/g, '_');

/**
 * @param {string} key - saved series key
 * @param {{ vibrationIds?: string[] }} [options] - live vibration equipment ids,
 *   used to recover ids whose underscores the save turned into hyphens
 * @returns {string} live key
 */
export function toLiveSeriesKey(key, { vibrationIds = [] } = {}) {
  if (typeof key !== 'string' || !key) return key;
  const parts = key.split(':');
  const head = parts[0];
  if (head === 'user') return key;
  if (head === 'global' && parts.length >= 2) {
    const metric = parts.slice(1).join(':');
    return `global:${metric === 'rings' || metric === 'coins' ? 'rings_total' : snake(metric)}`;
  }
  if ((head === 'bike' || head === 'device') && parts.length >= 3) {
    return `device:${parts[1]}:${snake(parts.slice(2).join(':'))}`;
  }
  if (head === 'vib' && parts.length >= 3) {
    const live = vibrationIds.find((id) => id.replace(/_/g, '-') === parts[1]);
    return `vib:${live || parts[1]}:${snake(parts.slice(2).join(':'))}`;
  }
  if (parts.length === 2) {
    const [id, metric] = parts;
    return `user:${id}:${PERSON_METRIC[metric] || snake(metric)}`;
  }
  return key;
}

/**
 * Re-key a saved series map for the live timeline. Zone letters are expanded
 * to the zone words the live recorder writes.
 * @param {Object<string, Array>} saved
 * @param {{ vibrationIds?: string[] }} [options]
 * @returns {Object<string, Array>}
 */
export function toLiveSeries(saved, options = {}) {
  const out = {};
  for (const [key, values] of Object.entries(saved || {})) {
    if (!Array.isArray(values)) continue;
    const liveKey = toLiveSeriesKey(key, options);
    const arr = /^user:.+:zone_id$/.test(liveKey)
      ? values.map((v) => (typeof v === 'string' && ZONE_WORDS[v] ? ZONE_WORDS[v] : v))
      : [...values];
    // A live key already present (a partially-live payload) wins.
    if (!(liveKey in out) || key === liveKey) out[liveKey] = arr;
  }
  return out;
}

export default toLiveSeries;
