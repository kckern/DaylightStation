import { describe, it, expect, vi } from 'vitest';
import { createLearnerActions } from '#apps/trigger/learnerActions.mjs';
import { TriggerDispatchService } from '#apps/trigger/TriggerDispatchService.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

// The registry shape composition actually hands the dispatcher, with the two
// readers this plan cares about: the study prints, the living room opens a
// reading session that nothing implements yet.
const registry = {
  nfc: {
    locations: {
      study: { target: 'portal', action: 'play-next', learner_action: 'print-agenda', auth_token: null, notify_unknown: null, defaults: {} },
      livingroom: { target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session', auth_token: null, notify_unknown: null, defaults: {} },
    },
    tags: {
      '048ba600cc2a81': { global: { note: 'learner-b personal card', school_learner: 'learner-b' }, overrides: {} },
    },
  },
};

function makeService(learnerActions, tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) }) {
  return new TriggerDispatchService({
    config: registry,
    contentIdResolver: { resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null },
    wakeAndLoadService: { execute: vi.fn() },
    haGateway: { callService: vi.fn().mockResolvedValue({ ok: true }) },
    deviceService: { get: vi.fn() },
    tagWriter,
    learnerActions,
    broadcast: vi.fn(),
    logger: silent,
  });
}

describe('trigger learner actions — composition contract', () => {
  it('print-agenda calls ResolvePersonalCard and reports its status', async () => {
    const calls = [];
    const resolvePersonalCard = {
      execute: async ({ learnerId }) => { calls.push(learnerId); return { status: 'agenda_printed', printed: true }; },
    };
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', ({ learnerId }) => resolvePersonalCard.execute({ learnerId }));

    const result = await learnerActions.get('print-agenda')({ learnerId: 'learner-b', location: 'study' });
    expect(calls).toEqual(['learner-b']);
    expect(result.status).toBe('agenda_printed');
  });

  it('a learner card at the study reader reaches print-agenda, learner and all', async () => {
    const seen = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async (args) => { seen.push(args); return { status: 'agenda_printed' }; });

    const result = await makeService(learnerActions).handleTrigger('study', 'nfc', '04:8B:A6:00:CC:2A:81');

    expect(result.ok).toBe(true);
    expect(result.action).toBe('print-agenda');
    expect(seen).toEqual([{ learnerId: 'learner-b', location: 'study', target: 'portal' }]);
    expect(result.dispatch.status).toBe('agenda_printed');
  });

  // THE NON-NEGOTIABLE. `reading-session` is deliberately unregistered, and the
  // failure mode being guarded is not "nothing happens" — it is the SAME card
  // silently running print-agenda because that is the only learner action
  // wired, so a child taps in the living room and a printer starts up in the
  // study two rooms away.
  it('the SAME card in the living room answers no_handler and never prints', async () => {
    const printed = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async (args) => { printed.push(args); return { status: 'agenda_printed' }; });

    const result = await makeService(learnerActions).handleTrigger('livingroom', 'nfc', '048ba600cc2a81');

    expect(result.dispatch).toMatchObject({ status: 'no_handler', op: 'reading-session', learnerId: 'learner-b' });
    expect(printed).toEqual([]);
  });

  it('and changes nothing in Home Assistant either', async () => {
    // The refused path ran the zombie-wake-guard suppression on its way past —
    // `livingroom-tv` is the one guarded target — so the tap that promises to
    // change nothing disabled a TV safety automation for 90 seconds. Only
    // content wakes a target; only content needs the guard out of the way.
    const haGateway = { callService: vi.fn().mockResolvedValue({ ok: true }) };
    const learnerActions = createLearnerActions({ logger: silent });
    const service = new TriggerDispatchService({
      config: registry,
      contentIdResolver: { resolve: () => null },
      wakeAndLoadService: { execute: vi.fn() },
      haGateway,
      deviceService: { get: vi.fn() },
      tagWriter: { recordObserved: vi.fn().mockResolvedValue({ created: true }) },
      learnerActions,
      broadcast: vi.fn(),
      logger: silent,
    });

    await service.handleTrigger('livingroom', 'nfc', '048ba600cc2a81');

    expect(haGateway.callService).not.toHaveBeenCalled();
  });

  it('a no_handler refusal does not file the card as an unknown tag', async () => {
    // The tag IS registered and named — it is the ACTION that has no owner. A
    // placeholder write and a phone push would misname the problem.
    const tagWriter = { recordObserved: vi.fn().mockResolvedValue({ created: true }) };
    const learnerActions = createLearnerActions({ logger: silent });
    await makeService(learnerActions, tagWriter).handleTrigger('livingroom', 'nfc', '048ba600cc2a81');
    expect(tagWriter.recordObserved).not.toHaveBeenCalled();
  });

  it('an unwired School degrades to the same named refusal, not a crash', async () => {
    // What app.mjs does when `schoolLifecycle.useCases.resolvePersonalCard` is
    // absent: register nothing, log it, and let the tap answer for itself.
    const learnerActions = createLearnerActions({ logger: silent });
    const result = await makeService(learnerActions).handleTrigger('study', 'nfc', '048ba600cc2a81');
    expect(result.dispatch).toMatchObject({ status: 'no_handler', op: 'print-agenda' });
  });
});

// The debounce exists to collapse HA's 2-3 fires per physical tap and to stop a
// child re-tapping through a 25s wake. It must not also swallow the retry that
// a FAILED action explicitly asks for: the receipt in the child's hand says
// "Try scanning again", and the bus path this replaces had no debounce at all.
describe('trigger learner actions — a failed action must be retryable', () => {
  it('lets the very next tap through when the action failed', async () => {
    const attempts = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => {
      attempts.push('tap');
      throw new Error('printer offline');
    });
    const service = makeService(learnerActions);

    await service.handleTrigger('study', 'nfc', '048ba600cc2a81');
    const second = await service.handleTrigger('study', 'nfc', '048ba600cc2a81');

    expect(second.debounced).toBeUndefined();
    expect(attempts).toEqual(['tap', 'tap']);
  });

  it('a handler that reports its own failure gets the same release', async () => {
    // The print-agenda wrapper marks School's `print_failed` retryable — the
    // use case reports it rather than throwing, so nothing else would.
    const attempts = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => {
      attempts.push('tap');
      return { status: 'print_failed', printed: false, retryable: true };
    });
    const service = makeService(learnerActions);

    await service.handleTrigger('study', 'nfc', '048ba600cc2a81');
    await service.handleTrigger('study', 'nfc', '048ba600cc2a81');

    expect(attempts).toEqual(['tap', 'tap']);
  });

  it('still debounces a SUCCESSFUL action — that lockout is the whole cooldown', async () => {
    const attempts = [];
    const learnerActions = createLearnerActions({ logger: silent });
    learnerActions.register('print-agenda', async () => {
      attempts.push('tap');
      return { status: 'agenda_printed', printed: true };
    });
    const service = makeService(learnerActions);

    await service.handleTrigger('study', 'nfc', '048ba600cc2a81');
    const second = await service.handleTrigger('study', 'nfc', '048ba600cc2a81');

    expect(second.debounced).toBe(true);
    expect(attempts).toEqual(['tap']);
  });

  it('still debounces a named refusal — retrying it changes nothing', async () => {
    const learnerActions = createLearnerActions({ logger: silent });
    const service = makeService(learnerActions);

    await service.handleTrigger('livingroom', 'nfc', '048ba600cc2a81');
    const second = await service.handleTrigger('livingroom', 'nfc', '048ba600cc2a81');

    expect(second.debounced).toBe(true);
  });

  // CONTRACT PIN for the expression in app.mjs's print-agenda registration.
  // It cannot be imported yet — plan 01 Task 9 extracts it into
  // `learnerCardActions.mjs`; until then this holds the shape it must keep.
  it('the print-agenda wrapper marks print_failed retryable and nothing else', async () => {
    const wrap = (result) => (result?.status === 'print_failed' ? { ...result, retryable: true } : result);
    expect(wrap({ status: 'print_failed', printed: false })).toMatchObject({ status: 'print_failed', retryable: true });
    expect(wrap({ status: 'agenda_printed', printed: true }).retryable).toBeUndefined();
    expect(wrap({ status: 'agenda_suppressed', sinceMinutes: 3 }).retryable).toBeUndefined();
    expect(wrap({ status: 'unknown_learner' }).retryable).toBeUndefined();
  });
});
