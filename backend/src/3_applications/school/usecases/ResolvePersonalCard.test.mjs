// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ResolvePersonalCard } from './ResolvePersonalCard.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };

/** An agenda double whose print is deliberately slow, to open the race window. */
function makeDeps({ printDelayMs = 50 } = {}) {
  const cooldownStore = new Map();
  const printed = [];
  return {
    printed,
    deps: {
      buildAgenda: {
        execute: async ({ learnerId }) => ({
          offers: [{ subject: 'civilization', unitId: 'u1', sessionId: 's1', label: 'L' }],
          createdSessions: [],
          document: { id: `agenda-${learnerId}` },
        }),
      },
      receipts: {
        print: async (doc) => {
          await new Promise((r) => setTimeout(r, printDelayMs));
          printed.push(doc.id);
          return { printed: true, reason: null };
        },
      },
      roster: { displayName: () => 'Learner' },
      // Mirrors the real `YamlAgendaCooldownStore`'s whitelist, which projects
      // to exactly these three fields on BOTH put (:82-89) and get (:68-73).
      // A double that stores the record verbatim would stay green if a future
      // field were silently dropped in production.
      cooldown: {
        get: async (id) => {
          const rec = cooldownStore.get(id);
          if (!rec) return null;
          return { learnerId: rec.learnerId, lastAgendaPrintedAt: rec.lastAgendaPrintedAt, contentHash: rec.contentHash };
        },
        put: async (rec) => {
          cooldownStore.set(rec.learnerId, {
            learnerId: rec.learnerId,
            lastAgendaPrintedAt: rec.lastAgendaPrintedAt,
            contentHash: rec.contentHash,
          });
        },
      },
      cooldownMinutes: 15,
      clock: () => new Date('2026-08-25T15:12:30.000Z'),
      logger: NOOP_LOGGER,
    },
  };
}

describe('ResolvePersonalCard concurrency', () => {
  it('prints ONCE when five taps arrive concurrently', async () => {
    const { deps, printed } = makeDeps();
    const card = new ResolvePersonalCard(deps);

    // The 2026-08-25 incident: five unawaited taps for one learner.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => card.execute({ learnerId: 'lrn' })),
    );

    expect(printed).toHaveLength(1);
    expect(results.filter((r) => r.status === 'agenda_printed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'agenda_suppressed')).toHaveLength(4);
  });

  it('does not serialise DIFFERENT learners against each other', async () => {
    // Concurrency asserted by OVERLAP, not by elapsed wall-clock: a
    // `Date.now() < 120` bound over two 40ms sleeps has ~30ms of headroom on a
    // host running the whole Docker fleet, and would flake for reasons that
    // have nothing to do with this lock.
    let inFlight = 0;
    let maxConcurrent = 0;
    const { deps, printed } = makeDeps();
    deps.receipts.print = async (doc) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      printed.push(doc.id);
      return { printed: true, reason: null };
    };
    const card = new ResolvePersonalCard(deps);

    await Promise.all([
      card.execute({ learnerId: 'a' }),
      card.execute({ learnerId: 'b' }),
    ]);

    expect(printed).toHaveLength(2);
    expect(maxConcurrent).toBe(2); // genuinely overlapped
  });
});

describe('suppressed taps do not leak live tokens', () => {
  it('revokes the token minted by a suppressed tap', async () => {
    const { deps } = makeDeps();
    const revoked = [];
    // Capture BOTH args. The real `ITokenRegistry.revoke(token, opts)` reads
    // no clock of its own (ITokenRegistry.mjs:99) and `YamlTokenRegistry`
    // throws without a valid `{ at }` ISO string (YamlTokenRegistry.mjs:408-
    // 410) — a throw here is caught and only WARN-logged by the production
    // code (a revoke failure must never fail a scan), so a test that checks
    // only the token would stay green while production silently revoked
    // nothing. Assert the actual `at` value, not just that `opts` is truthy —
    // `{ reason: 'suppressed' }` would also be "truthy".
    deps.tokens = { revoke: async (token, opts) => { revoked.push([token, opts]); } };
    // Replace the buildAgenda double so it reports a minted token.
    const base = deps.buildAgenda.execute;
    deps.buildAgenda.execute = async (args) => ({
      ...(await base(args)),
      mintedTokens: ['sch:TESTTOKEN'],
    });

    const card = new ResolvePersonalCard(deps);
    await card.execute({ learnerId: 'lrn' });   // prints, arms cooldown
    await card.execute({ learnerId: 'lrn' });   // suppressed

    expect(revoked).toEqual([['sch:TESTTOKEN', { at: '2026-08-25T15:12:30.000Z' }]]);
  });
});
