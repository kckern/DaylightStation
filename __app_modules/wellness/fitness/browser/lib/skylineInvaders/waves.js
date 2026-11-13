// The wave list: one row per level in world order, with what tells the waves
// apart (the threat each one brings in first) and the rider's place on the
// world map. Pure.

const THREAT_NAMES = Object.freeze({ meteor: 'Meteors', drone: 'Drones', pod: 'Pods', bomber: 'Bombers' });
const STATUS_WORDS = Object.freeze({ completed: 'Done', locked: 'Locked', open: 'New' });

const spawnTypes = (level) => [...new Set((level.waves || []).flatMap((wave) => Object.keys(wave.spawn || {})))];

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * @param {object[]} levels   validated levels in world order
 * @param {{ levels: object[] }|null} world   null = every level open
 * @returns {{ id, name, status, word, stars, introduces: string[], detail: string }[]}
 */
export function waveRows(levels = [], world = null) {
  const seen = new Set();
  return levels.map((level) => {
    const entry = world?.levels?.find((item) => item.id === level.id) || null;
    const status = world ? entry?.status || 'open' : 'open';
    const introduces = spawnTypes(level).filter((type) => !seen.has(type));
    spawnTypes(level).forEach((type) => seen.add(type));
    const stars = Math.max(0, Math.min(3, Number(entry?.best?.stars) || 0));
    const parts = [
      introduces.length ? `New: ${introduces.map((type) => THREAT_NAMES[type] || type).join(', ')}` : null,
      `Shoot down ${level.pass?.kills ?? 0}`,
      clock(level.duration_s || 0),
    ].filter(Boolean);
    return { id: level.id, name: level.name, status, word: STATUS_WORDS[status] || STATUS_WORDS.open, stars, introduces, detail: parts.join(' · ') };
  });
}

const statusOf = (world, id) => (world ? world.levels?.find((item) => item.id === id)?.status || 'open' : 'open');

/** The wave offered first: the rider's next one on the world map, else the first open one. */
export function defaultLevelId(levels, world) {
  const open = levels.filter((level) => statusOf(world, level.id) !== 'locked');
  return (open.find((level) => level.id === world?.next) || open[0] || levels[0] || null)?.id ?? null;
}

/** The wave in play for a choice: the chosen one when it is open, else the default. */
export function resolveLevelId(levels, world, chosenLevelId) {
  const chosen = levels.find((level) => level.id === chosenLevelId);
  return chosen && statusOf(world, chosen.id) !== 'locked' ? chosen.id : defaultLevelId(levels, world);
}
