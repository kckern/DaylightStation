/**
 * Resolve a free-form name like "office light" to an HA entity_id (e.g. "light.office_main").
 * Strategy:
 *   1. Exact alias hit (config.friendly_name_aliases).
 *   2. Token-overlap fuzzy match against state names + entity ids from gateway.listAllStates().
 *
 * @param {{ name: string, gateway: object, aliases?: object, domain?: string|null }} args
 * @returns {Promise<{ entityId: string|null, reason: string, candidates?: string[] }>}
 */
export async function resolveEntity({ name, gateway, aliases = {}, domain = null }) {
  if (!name) return { entityId: null, reason: 'empty' };
  const norm = String(name).trim().toLowerCase();
  if (aliases[norm]) return { entityId: aliases[norm], reason: 'alias' };

  const all = await safeStates(gateway);
  const candidates = all
    .filter((s) => !domain || s.entityId.startsWith(`${domain}.`))
    .map((s) => {
      const friendly = String(s.attributes?.friendly_name ?? '').toLowerCase();
      const eid = s.entityId.toLowerCase();
      const score = scoreMatch(norm, [friendly, eid.replace(/^[a-z_]+\./, '').replace(/_/g, ' ')]);
      return { entityId: s.entityId, friendly, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { entityId: null, reason: 'no_match', candidates: [] };
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return {
      entityId: null,
      reason: 'ambiguous',
      candidates: candidates.slice(0, 5).map((c) => c.entityId),
    };
  }
  return {
    entityId: candidates[0].entityId,
    reason: 'fuzzy',
    candidates: candidates.slice(0, 5).map((c) => c.entityId),
  };
}

function scoreMatch(query, names) {
  const queryTokens = new Set(query.split(/\s+/).filter(Boolean));
  let best = 0;
  for (const name of names) {
    const tokens = new Set(name.split(/[\s_]+/).filter(Boolean));
    let hits = 0;
    for (const t of queryTokens) if (tokens.has(t)) hits++;
    if (hits > 0) {
      const score = hits / Math.max(queryTokens.size, tokens.size);
      if (score > best) best = score;
    }
  }
  return best;
}

async function safeStates(gateway) {
  try {
    if (typeof gateway.listAllStates === 'function') {
      const list = await gateway.listAllStates();
      return Array.isArray(list) ? list : [];
    }
    return [];
  } catch {
    return [];
  }
}
