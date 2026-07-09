#!/usr/bin/env node
// cli/curriculum/migrateProgress.mjs — remap plex:{ratingKey} progress keys via a map.
export function remapProgress(progress, map) {
  const out = {}; let moved = 0; let kept = 0;
  const put = (key, val) => {
    if (out[key]) {
      const a = Date.parse(out[key].lastPlayed || 0) || 0;
      const b = Date.parse(val.lastPlayed || 0) || 0;
      if (b > a) out[key] = val;                 // newer wins on collision
    } else out[key] = val;
  };
  for (const [key, val] of Object.entries(progress || {})) {
    const m = key.match(/^plex:(\d+)$/);
    if (m && map[m[1]]) { put(`plex:${map[m[1]]}`, val); moved += 1; }
    else { put(key, val); kept += 1; }
  }
  return { out, moved, kept };
}
