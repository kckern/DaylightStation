import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import { earningsByLearner, ringProgressByLearner } from '../status/agendaStatusModel.js';

const good = result => result?.ok && result.data;
const number = value => Number.isFinite(value) ? value : null;
const GROUP_ORDER = ['move', 'school', 'games'];

function bounded(read, resource) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      schoolLog.selfServiceError('rewards.preload-failed', { resource, reason: 'timeout' });
      resolve({ ok: false });
    }, 15_000);
    Promise.resolve().then(read).then(result => { clearTimeout(timer); resolve(result); }, error => {
      clearTimeout(timer);
      schoolLog.selfServiceError('rewards.preload-failed', { resource, error: error?.message });
      resolve({ ok: false });
    });
  });
}

function personalGems(board, learnerId) {
  return (board?.categories ?? []).map(category => ({ ...category, cell: board.cells?.[category.id]?.[learnerId] }))
    .filter(row => row.cell && row.cell.state !== 'disabled')
    .sort((a, b) => {
      const rank = id => { const n = GROUP_ORDER.indexOf(id); return n < 0 ? GROUP_ORDER.length : n; };
      return rank(a.group) - rank(b.group);
    })
    .map(row => ({ ...row, cell: { ...row.cell, parts: (row.cell.parts ?? []).map(part => ({ ...part,
      ...(part.score ? { score: { ...part.score, standings: [] } } : {}),
    })) } }));
}

/** Page-memory only. The opening retains its snapshot while later polls replace memory. */
export function createRewardsCache(api = schoolApi, { readGates = () => api.stateGates({ gateId: 'fitness.weekly-rings', periodKind: 'interval' }) } = {}) {
  let snapshots = {};
  let currentIds = [];
  let active = null;
  let activeKey = '';
  let rerun = false;
  const listeners = new Set();
  const publish = next => { snapshots = next; for (const listener of listeners) listener(); };

  const refresh = (ids = currentIds, { again = false } = {}) => {
    currentIds = [...new Set(ids)].sort();
    const wanted = new Set(currentIds);
    if (Object.keys(snapshots).some(id => !wanted.has(id))) publish(Object.fromEntries(Object.entries(snapshots).filter(([id]) => wanted.has(id))));
    const key = currentIds.join('|');
    if (active) { rerun ||= again || key !== activeKey; return active; }
    if (!currentIds.length) return Promise.resolve();
    const readingIds = [...currentIds]; activeKey = key;
    active = Promise.all([
      bounded(() => api.earningsRoster(), 'earnings'),
      bounded(() => api.gems(), 'gems'),
      bounded(readGates, 'rings'),
      ...readingIds.map(id => bounded(() => api.wallet(id), 'wallet')),
    ]).then(([earnings, gems, gates, ...wallets]) => {
      const priced = good(earnings) ? earningsByLearner(earnings.data) : {};
      const gatesReady = good(gates) && Array.isArray(gates.data.items);
      const rings = gatesReady ? ringProgressByLearner(gates.data) : {};
      const candidate = good(gems) ? gems.data : null;
      const board = candidate && typeof candidate.mode === 'string' && Array.isArray(candidate.categories)
        && (candidate.mode === 'off' || Array.isArray(candidate.learners)) ? candidate : null;
      const week = earnings?.data?.windows?.school?.from ?? board?.week ?? null;
      const next = { ...snapshots };
      readingIds.forEach((id, index) => {
        if (!currentIds.includes(id)) return;
        const old = snapshots[id];
        const gemWeek = board?.week ?? board?.windows?.school?.from;
        const aligned = !week || !gemWeek || week === gemWeek;
        // A week changes as one unit: never open new silver beside old gems.
        if ((old?.week && week && old.week !== week && (!good(earnings) || !board || !aligned)) || (!aligned && old)) {
          next[id] = { ...old, stale: true, error: { kind: 'week-mismatch' }, fields: Object.fromEntries(Object.entries(old.fields ?? {}).map(([name, field]) => [name, { ...field, stale: true, error: { kind: 'week-mismatch' } }])) };
          return;
        }
        if (!aligned) {
          next[id] = { learnerId: id, week: null, mode: 'unknown', silver: null,
            gold: good(wallets[index]) ? number(wallets[index].data?.balances?.gold) : null,
            rings: number(rings[id]?.current), gems: [], groups: [], updatedAt: null, lastSuccessAt: null,
            stale: true, error: { kind: 'week-mismatch' },
            fields: Object.fromEntries(['silver', 'gold', 'rings', 'gems'].map(name => [name, {
              lastSuccessAt: null, stale: true, error: { kind: 'week-mismatch' },
            }])),
          };
          return;
        }
        const sameWeek = !old?.week || !week || old.week === week;
        const gemReady = board && (board.mode !== 'live' || board.learners?.some(learner => learner.learnerId === id));
        const now = Date.now();
        const verified = {
          silver: number(priced[id]?.silver) !== null && Boolean(good(earnings)),
          gold: number(good(wallets[index]) ? wallets[index].data?.balances?.gold : null) !== null,
          rings: gatesReady, gems: Boolean(gemReady),
        };
        const responses = { silver: earnings, gold: wallets[index], rings: gates, gems };
        const fields = Object.fromEntries(Object.entries(verified).map(([name, ready]) => [name, {
          lastSuccessAt: ready ? now : (name === 'gold' || sameWeek ? old?.fields?.[name]?.lastSuccessAt ?? null : null),
          stale: !ready,
          error: ready ? null : { status: responses[name]?.status ?? 0, kind: responses[name]?.ok ? 'invalid-data' : 'unavailable' },
        }]));
        const stale = Object.values(fields).some(field => field.stale);
        next[id] = {
          learnerId: id,
          week: week ?? old?.week ?? null,
          mode: board?.mode ?? old?.mode ?? 'unknown',
          silver: number(priced[id]?.silver) ?? (sameWeek ? old?.silver : null) ?? null,
          gold: number(good(wallets[index]) ? wallets[index].data?.balances?.gold : null) ?? old?.gold ?? null,
          rings: gatesReady ? number(rings[id]?.current) : sameWeek ? old?.rings ?? null : null,
          gems: gemReady ? personalGems(board, id) : sameWeek ? old?.gems ?? [] : [],
          groups: gemReady ? (Array.isArray(board.groups) ? board.groups : []) : sameWeek ? old?.groups ?? [] : [],
          fields, stale, error: stale ? { kind: 'partial-read' } : null,
          updatedAt: stale ? old?.updatedAt ?? null : now,
          lastSuccessAt: stale ? old?.lastSuccessAt ?? null : now,
        };
      });
      publish(next);
    }).finally(() => {
      active = null;
      if (rerun) { rerun = false; refresh(currentIds); }
    });
    return active;
  };

  return {
    getSnapshot: () => snapshots,
    getLearner: id => snapshots[id],
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
  };
}

export const rewardsCache = createRewardsCache();
