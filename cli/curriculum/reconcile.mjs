#!/usr/bin/env node
// cli/curriculum/reconcile.mjs — Plex allLeaves parse + old→new ratingKey map composition.
export function parseAllLeaves(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<Video\b[^>]*>/g)) {
    const tag = m[0];
    const rk = tag.match(/\bratingKey="(\d+)"/);
    const ps = tag.match(/\bparentIndex="(\d+)"/);
    const ix = tag.match(/\bindex="(\d+)"/);
    if (rk && ps && ix) out.push({ ratingKey: rk[1], season: Number(ps[1]), episode: Number(ix[1]) });
  }
  return out;
}

export function composeRatingKeyMap({ before, plan, after }) {
  const oldRkBySE = new Map(before.map((r) => [`${r.season}:${r.episode}`, r.ratingKey]));
  const newRkBySE = new Map(after.map((r) => [`${r.season}:${r.episode}`, r.ratingKey]));
  const map = {}; const unmatched = [];
  for (const e of plan.episodes) {
    const oldRk = oldRkBySE.get(`${e.oldSeason}:${e.oldEpisode}`);
    if (!oldRk) continue;                         // old ep not in Plex (shouldn't happen)
    const newRk = newRkBySE.get(`${e.newSeason}:${e.newEpisode}`);
    if (newRk) map[oldRk] = newRk; else unmatched.push(oldRk);
  }
  return { map, unmatched };
}
