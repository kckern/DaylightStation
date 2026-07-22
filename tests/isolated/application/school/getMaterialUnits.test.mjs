import { describe, it, expect, beforeEach } from 'vitest';
import { GetMaterialUnits, buildBankIndex } from '#apps/school/GetMaterialUnits.mjs';

const CONFIG = { completion_threshold_percent: 90, quiz_pass_percent: 80 };

function makeUnits() {
  return [
    { id: 'plex:u1', index: 1, title: 'Act 1', durationMs: 60000, group: null },
    { id: 'plex:u2', index: 2, title: 'Act 2', durationMs: 60000, group: null },
    { id: 'plex:u3', index: 3, title: 'Act 3', durationMs: 60000, group: null },
  ];
}

function makeCatalog(material) {
  return { findMaterial: async (id) => (id === material.id ? { entry: { label: 'Shakespeare', source: 'plex-album', root: '619778', medium: 'audio', category: material.category }, material } : null) };
}

function makeSources(fullMaterial) {
  return { 'plex-album': { getMaterial: async () => fullMaterial } };
}

// progressStore stub mirrors UserVideoProgressStore.enrich: matches units by id,
// adds userPercent/userPlayhead (+ Piano-only fields School must ignore), leaves
// items untouched for an unknown user.
function makeProgressStore(progressByUnitId, knownUsers = ['kid1']) {
  return {
    enrich: (units, userId) => {
      if (!knownUsers.includes(userId)) return units;
      return units.map((u) => {
        const p = progressByUnitId[u.id];
        if (!p) return { ...u, userPercent: null, userPlayhead: null, userWatched: false, userEngaged: false, userCompletedAt: null };
        return {
          ...u,
          userPercent: p.percent,
          userPlayhead: p.playhead,
          // Piano-policy fields — School must never read these for completion.
          userWatched: true,
          userEngaged: true,
          userCompletedAt: '2026-01-01T00:00:00.000Z',
        };
      });
    },
  };
}

let logger, errors, warns;
beforeEach(() => {
  errors = []; warns = [];
  logger = { error: (e, d) => errors.push({ e, d }), warn: (e, d) => warns.push({ e, d }), info: () => {} };
});

describe('buildBankIndex', () => {
  it('indexes banks carrying a unit backlink, ignoring banks with none', () => {
    const banks = [
      { id: 'act1-quiz', unit: 'plex:u1', itemCount: 4 },
      { id: 'no-unit-bank', itemCount: 2 },
      { id: 'act2-quiz', unit: 'plex:u2', itemCount: 5 },
    ];
    const idx = buildBankIndex(banks);
    expect(idx.byUnit('plex:u1')).toEqual({ bankId: 'act1-quiz', itemCount: 4 });
    expect(idx.byUnit('plex:u2')).toEqual({ bankId: 'act2-quiz', itemCount: 5 });
    expect(idx.byUnit('plex:u3')).toBeNull();
  });
});

describe('GetMaterialUnits.execute — ungated (listening) material', () => {
  it('completes a unit on played percent alone; no quiz, no lock', async () => {
    const material = { id: 'plex:619778-1', title: 'I Survived', category: 'listening' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([]); // no banks at all
    const progressStore = makeProgressStore({ 'plex:u1': { percent: 95, playhead: 55000 } });
    const attemptsReader = { read: () => [] };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: 'kid1' });

    expect(units[0].percent).toBe(95);
    expect(units[0].playhead).toBe(55000);
    expect(units[0].completed).toBe(true);
    expect(units[0].locked).toBe(false);
    expect(units[0].quiz).toBeNull();
  });
});

describe('GetMaterialUnits.execute — quiz-gated (course) material', () => {
  it('a unit at 100% watched but no passing quiz session stays incomplete AND locks successors', async () => {
    const material = { id: 'plex:619778', title: 'Hamlet', category: 'course' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([{ id: 'act1-quiz', unit: 'plex:u1', itemCount: 4 }]);
    const progressStore = makeProgressStore({
      'plex:u1': { percent: 100, playhead: 60000 },
      'plex:u2': { percent: 0, playhead: 0 },
      'plex:u3': { percent: 0, playhead: 0 },
    });
    const attemptsReader = { read: () => [] }; // no attempts at all -> gate never satisfied

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: 'kid1' });

    expect(units[0].percent).toBe(100);
    expect(units[0].quiz).toEqual({ bankId: 'act1-quiz' });
    expect(units[0].completed).toBe(false); // gate unsatisfied -> incomplete despite 100% played
    expect(units[0].locked).toBe(false);
    expect(units[0].current).toBe(true);
    expect(units[0].lockReason).toBeNull();

    expect(units[1].locked).toBe(true);
    expect(units[1].current).toBe(false);
    expect(units[1].lockReason).toMatch(/Act 1/);
    expect(units[2].locked).toBe(true);
  });

  it('a passing quiz session satisfies the gate and unlocks the next unit', async () => {
    const material = { id: 'plex:619778', title: 'Hamlet', category: 'course' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([{ id: 'act1-quiz', unit: 'plex:u1', itemCount: 4 }]);
    const progressStore = makeProgressStore({
      'plex:u1': { percent: 100, playhead: 60000 },
    });
    const attemptsReader = {
      read: () => [
        { mode: 'quiz', bankId: 'act1-quiz', sessionId: 's1', itemId: 'q1', correct: true },
        { mode: 'quiz', bankId: 'act1-quiz', sessionId: 's1', itemId: 'q2', correct: true },
        { mode: 'quiz', bankId: 'act1-quiz', sessionId: 's1', itemId: 'q3', correct: true },
        { mode: 'quiz', bankId: 'act1-quiz', sessionId: 's1', itemId: 'q4', correct: true },
      ],
    };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: 'kid1' });

    expect(units[0].completed).toBe(true);
    expect(units[1].locked).toBe(false);
    expect(units[1].current).toBe(true);
  });

  it('guest (no userId) gets percent:null and gateSatisfied treated as false, locks computed as a fresh user', async () => {
    const material = { id: 'plex:619778', title: 'Hamlet', category: 'course' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([{ id: 'act1-quiz', unit: 'plex:u1', itemCount: 4 }]);
    const progressStore = makeProgressStore({ 'plex:u1': { percent: 100, playhead: 60000 } });
    const attemptsReader = { read: () => { throw new Error('must not be called without a userId'); } };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: undefined });

    expect(units[0].percent).toBeNull();
    expect(units[0].playhead).toBeNull();
    expect(units[0].completed).toBe(false);
    expect(units[0].current).toBe(true);
    expect(units[1].locked).toBe(true);
  });
});

describe('GetMaterialUnits.execute — course unit with NO authored quiz (needsQuiz)', () => {
  it('fully watched but bankless: incomplete, successors locked with the request-a-quiz reason', async () => {
    const material = { id: 'plex:489954', title: 'Cash Course', category: 'course' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([]); // nothing authored yet
    const progressStore = makeProgressStore({
      'plex:u1': { percent: 100, playhead: 60000 },
      'plex:u2': { percent: 0, playhead: 0 },
      'plex:u3': { percent: 0, playhead: 0 },
    });
    const attemptsReader = { read: () => [] };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: 'kid1' });

    expect(units[0].completed).toBe(false); // watched, but the gate is unmet in principle
    expect(units[0].needsQuiz).toBe(true);
    expect(units[0].quiz).toBeNull();
    expect(units[0].current).toBe(true);
    expect(units[1].locked).toBe(true);
    expect(units[1].lockReason).toMatch(/waiting for its quiz/);
  });
});

describe('GetMaterialUnits.execute — reference material', () => {
  it('is never locked and never completed, regardless of percent or gates', async () => {
    const material = { id: 'plex:cliffnotes-1', title: 'Cliff Notes: Hamlet', category: 'reference' };
    const full = { ...material, units: makeUnits() };
    const catalog = makeCatalog(material);
    const sources = makeSources(full);
    const bankIndex = buildBankIndex([{ id: 'act1-quiz', unit: 'plex:u1', itemCount: 4 }]);
    const progressStore = makeProgressStore({
      'plex:u1': { percent: 100, playhead: 60000 },
      'plex:u2': { percent: 100, playhead: 60000 },
      'plex:u3': { percent: 100, playhead: 60000 },
    });
    const attemptsReader = { read: () => [] };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });
    const { units } = await useCase.execute({ materialId: material.id, userId: 'kid1' });

    for (const u of units) {
      expect(u.completed).toBe(false);
      expect(u.locked).toBe(false);
      expect(u.current).toBe(false);
      expect(u.lockReason).toBeNull();
    }
  });
});

describe('GetMaterialUnits.execute — unknown materialId', () => {
  it('throws the school domain not-found error style', async () => {
    const catalog = { findMaterial: async () => null };
    const sources = {};
    const bankIndex = buildBankIndex([]);
    const progressStore = makeProgressStore({});
    const attemptsReader = { read: () => [] };

    const useCase = new GetMaterialUnits({ catalog, sources, config: CONFIG, progressStore, bankIndex, attemptsReader, logger });

    await expect(useCase.execute({ materialId: 'plex:nope', userId: 'kid1' })).rejects.toThrow(/plex:nope/);
  });
});
