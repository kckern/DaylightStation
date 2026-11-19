// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ResolveAccessCode } from "./ResolveAccessCode.mjs";
import { RunSelfServiceAction } from "./RunSelfServiceAction.mjs";
import { mintToken } from "../../domain/sessions/tokens.mjs";

const NOW = '2026-09-10T18:00:00.000Z';
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const record = mintToken({
  tokenClass: 'makeup_print', subject: { learnerId: 'kid' },
  at: '2026-09-10T15:00:00.000Z', rng: () => 0.5, expiresAt: '2026-09-13T11:00:00.000Z',
  accessCode: '424242', accessCodeExpiresAt: '2026-09-11T11:00:00.000Z', maxUses: 3,
});
const WORK = { deadline: '2026-09-12', items: [{ day: '2026-09-07', subject: 'math' }, { day: '2026-09-09', subject: 'math' }] };

function resolver(work) {
  return new ResolveAccessCode({
    tokens: { getByAccessCode: vi.fn(async (code) => (code === '424242' ? record : null)) },
    curriculum: {}, assignments: {}, sessions: {},
    getMakeupWork: { execute: vi.fn(async () => work) },
    clock: () => new Date(NOW), logger: silent,
  });
}

describe('typed makeup_print code', () => {
  it('resolves to one card listing each subject owed, with a Print button', async () => {
    const { card, resolution } = await resolver(WORK).resolve({ code: '424242' });
    expect(card).toMatchObject({
      ok: true, learner: 'kid', title: 'Makeup work', bulk: true,
      items: [{ subject: 'math', title: 'Mon, Wed' }],
      sentence: 'Due Saturday night.',
    });
    expect(card.actions.map((a) => a.kind)).toEqual(['print', 'exit']);
    expect(resolution).toEqual({ kind: 'makeup_print', learnerId: 'kid' });
  });

  it('nothing owed: an all-done card with only a way out', async () => {
    const { card, resolution } = await resolver({ deadline: null, items: [] }).resolve({ code: '424242' });
    expect(card).toMatchObject({ ok: true, sentence: 'Nothing to make up. Well done!' });
    expect(card.actions.map((a) => a.kind)).toEqual(['exit']);
    expect(resolution).toBeNull();
  });

  it('the Print button prints the makeup sheet and spends one use', async () => {
    const printMakeupAgenda = { execute: vi.fn(async () => ({ printed: true })) };
    const tokens = { recordUse: vi.fn(async () => {}) };
    const action = new RunSelfServiceAction({
      resolveAccessCode: resolver(WORK), sessions: {}, tokens, printMakeupAgenda,
      clock: () => new Date(NOW), logger: silent,
    });
    const out = await action.execute({ code: '424242', action: 'print' });
    expect(printMakeupAgenda.execute).toHaveBeenCalledWith({ learnerId: 'kid' });
    expect(out).toMatchObject({ outcome: 'done', sentence: 'Printing your makeup sheet.' });
    expect(tokens.recordUse).toHaveBeenCalledWith(record.token, expect.any(Object));
  });
});
