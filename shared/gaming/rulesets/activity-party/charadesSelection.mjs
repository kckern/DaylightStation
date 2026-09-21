import { shuffle } from '../../mechanics/random.mjs';

function performerId(performer) {
  return performer?.id || performer?.participant_id || performer?.user_id || null;
}

export function createSeededRoundOrder(performers, rounds, seed = 1) {
  const ids = (performers || []).map(performerId);
  if (ids.length === 0 || ids.some((id) => id == null)) throw new Error('Seeded round selection requires identified performers');
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('Seeded round selection requires unique performers');
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('Seeded round selection requires positive rounds');

  const order = [];
  let rngState = Number(seed) >>> 0;
  for (let round = 0; round < rounds; round += 1) {
    const shuffled = shuffle(ids, rngState);
    order.push(...shuffled.items);
    rngState = shuffled.rngState;
  }
  return { order, rngState };
}

function nextFromPool(pool, cursors, poolName, rngState) {
  let cursor = cursors[poolName];
  if (!cursor || cursor.position >= cursor.order.length) {
    const shuffled = shuffle(pool, rngState);
    const order = shuffled.items;
    if (cursor?.last != null && order.length > 1 && order[0] === cursor.last) {
      [order[0], order[1]] = [order[1], order[0]];
    }
    cursor = { order, position: 0, last: cursor?.last ?? null };
    cursors[poolName] = cursor;
    rngState = shuffled.rngState;
  }
  const selected = cursor.order[cursor.position];
  cursor.position += 1;
  cursor.last = selected;
  return { selected, rngState };
}

function usedInCurrentCycle(pool, challenges, historyIds) {
  const eligible = new Set(pool.map(index => String(challenges[index].id)));
  const used = new Set();
  for (const id of historyIds || []) {
    const key = String(id);
    if (!eligible.has(key)) continue;
    used.add(key);
    if (used.size === eligible.size) used.clear();
  }
  return used;
}

function startUnusedCycle(pool, challenges, historyIds, cursors, poolName, rngState) {
  const used = usedInCurrentCycle(pool, challenges, historyIds);
  const unused = pool.filter(index => !used.has(String(challenges[index].id)));
  if (unused.length === 0) return rngState;
  const shuffled = shuffle(unused, rngState);
  cursors[poolName] = { order: shuffled.items, position: 0, last: null };
  return shuffled.rngState;
}

export function createCharadesChallengeOrder({ challenges, turnOrder, cluesPerTurn, imageParticipantIds = [], historyIds = null, seed = 1 }) {
  const imagePool = [];
  const textPool = [];
  for (const [index, challenge] of (challenges || []).entries()) {
    (challenge?.decoder?.image ? imagePool : textPool).push(index);
  }
  const imageIds = new Set(imageParticipantIds.map(String));
  const cursors = {};
  const order = [];
  const presentations = [];
  let rngState = Number(seed) >>> 0;

  for (const participantId of turnOrder || []) {
    const presentation = imageIds.has(String(participantId)) ? 'image' : 'text';
    const pool = presentation === 'image' ? imagePool : textPool;
    if (pool.length === 0) throw new Error(`Charades ${presentation} challenge pool is required for participant ${participantId}`);
    for (let clue = 0; clue < cluesPerTurn; clue += 1) {
      if (!cursors[presentation] && Array.isArray(historyIds)) {
        rngState = startUnusedCycle(pool, challenges, historyIds, cursors, presentation, rngState);
      }
      const next = nextFromPool(pool, cursors, presentation, rngState);
      order.push(next.selected);
      presentations.push(presentation);
      rngState = next.rngState;
    }
  }
  return { order, presentations, rngState };
}
