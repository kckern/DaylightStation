import { describe, expect, it, vi } from 'vitest';
import { BuildAgenda } from "./BuildAgenda.mjs";
import { appendAssignedProgramEntries } from "../assignedProgramPlan.mjs";
import { validateDocument } from "../../domain/documents/documentValidation.mjs";

// Thu 2026-09-10, 09:00 PDT. Monday's math is still owed; the deadline is Sat.
const NOW = '2026-09-10T16:00:00.000Z';
const MAKEUP = { deadline: '2026-09-12', items: [{ day: '2026-09-07', subject: 'math' }, { day: '2026-09-09', subject: 'english' }] };

function seededRng(seed = 11) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function fixture({ work = MAKEUP, previewOnly = false, selfService = { enabled: true } } = {}) {
  const assignment = { learnerId: 'kid', courses: [], programs: [{ programId: 'piano-course', subject: 'arts', courseId: 'hoffman' }] };
  const plan = appendAssignedProgramEntries({ entries: [], errors: [] }, assignment);
  const sections = [{ subject: 'arts', servedToday: false, progressRows: [], next: plan.entries[0] }];
  const planProjection = { project: vi.fn(async () => ({
    plan, sections, activeExceptions: [],
    projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW },
  })) };
  const tokens = { put: vi.fn(async () => {}), liveAccessCodes: vi.fn(async () => []) };
  const getMakeupWork = work === undefined ? null : { execute: vi.fn(async () => work) };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const make = (extra = {}) => new BuildAgenda({
    curriculum: {}, assignments: {}, sessions: {}, tokens, planProjection,
    launchers: new Map([['piano-course', { locationHint: 'on the piano' }]]),
    clock: () => new Date(NOW), timezone: 'America/Los_Angeles', rng: seededRng(),
    selfService, previewOnly, logger, ...extra,
  });
  return { make, tokens, getMakeupWork };
}

const minted = (tokens, tokenClass) => tokens.put.mock.calls.map(([r]) => r).filter((r) => r.tokenClass === tokenClass);

describe('BuildAgenda makeup card', () => {
  it('mints one makeup_print ticket naming only the learner, and carries one card', async () => {
    const { make, tokens, getMakeupWork } = fixture();
    const out = await make({ getMakeupWork }).execute({ learnerId: 'kid', learnerName: 'Kid' });
    const [record] = minted(tokens, 'makeup_print');
    expect(minted(tokens, 'makeup_print')).toHaveLength(1);
    expect(record.subject).toEqual({ learnerId: 'kid' });
    // Lives to the end of Saturday's study day (Sun 04:00 PDT); the code to tonight's rollover.
    expect(record.expiresAt).toBe('2026-09-13T11:00:00.000Z');
    expect(record.accessCodeExpiresAt).toBe('2026-09-11T11:00:00.000Z');
    expect(out.mintedTokens).toContain(record.token);
    expect(out.makeup).toEqual(MAKEUP);
    expect(() => validateDocument(out.document)).not.toThrow();
    expect(out.document.blocks.some((b) => b.md === 'Makeup work: Mon Math, Wed English. Due Saturday night.')).toBe(true);
    const card = out.document.blocks.find((b) => b.type === 'scan_action' && b.action === record.token);
    expect(card).toMatchObject({ label: 'Scan to print your makeup sheet', panelCode: record.accessCode });
  });

  it('absent makeup: the agenda is byte-identical to one built without the feature', async () => {
    const a = fixture({ work: { deadline: null, items: [] } });
    const withFeature = await a.make({ getMakeupWork: a.getMakeupWork }).execute({ learnerId: 'kid', learnerName: 'Kid' });
    const b = fixture({ work: undefined });
    const without = await b.make().execute({ learnerId: 'kid', learnerName: 'Kid' });
    expect(JSON.stringify(withFeature.document)).toBe(JSON.stringify(without.document));
    expect(withFeature).not.toHaveProperty('makeup');
    expect(minted(a.tokens, 'makeup_print')).toHaveLength(0);
  });

  it('preview mints nothing and draws an inert card', async () => {
    const { make, tokens, getMakeupWork } = fixture({ previewOnly: true });
    const out = await make({ getMakeupWork }).execute({ learnerId: 'kid' });
    expect(tokens.put).not.toHaveBeenCalled();
    expect(out.makeup).toEqual(MAKEUP);
    expect(out.document.blocks.some((b) => b.action === 'preview:not-a-makeup-ticket')).toBe(true);
  });

  it('a dry run of another day carries no makeup', async () => {
    const { make, getMakeupWork } = fixture({ previewOnly: true });
    const out = await make({ getMakeupWork }).execute({ learnerId: 'kid', studyDay: '2026-09-14' });
    expect(getMakeupWork.execute).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty('makeup');
  });

  it('a failing makeup read costs the card, never the agenda', async () => {
    const { make } = fixture();
    const getMakeupWork = { execute: vi.fn(async () => { throw new Error('boom'); }) };
    const out = await make({ getMakeupWork }).execute({ learnerId: 'kid' });
    expect(out).not.toHaveProperty('makeup');
    expect(out.document.blocks.length).toBeGreaterThan(0);
  });
});
