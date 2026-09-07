/**
 * Code → shelf, with no card in between (2026-09-06).
 *
 * A reading code resolved to a launch card whose entire content was one button
 * reading "Open Reading", above a "Go back". The child had just spelled out,
 * in six digits, the sentence that button says — so the card asked them to
 * confirm a decision they had already made, on a panel a six-year-old stands
 * at. Two screens and a tap for nothing.
 *
 * The backend now marks such a card `presentation.openImmediately`, and the
 * panel runs its single action instead of rendering it. What it must NOT skip
 * is the identity question: `confirmIdentity` exists to ask whose paper this is
 * BEFORE anything records against them, and the two are exclusive by
 * construction.
 *
 * And it is deliberately narrow — a printing card also carries one button, and
 * auto-running that one would fire a thermal printer at a child who typed their
 * code to see what was next.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from './Keypad.jsx';
import LaunchCard from './LaunchCard.jsx';
import { useSelfService } from './useSelfService.js';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

const claim = vi.fn();
const onLaunch = vi.fn(async () => true);

const READING_ACTION = {
  kind: 'program', label: 'Open Reading', role: 'primary', target: 'book-log',
};
const EXIT_ACTION = { kind: 'exit', label: 'Go back', role: 'secondary' };

const card = ({ actions, presentation }) => ({
  ok: true,
  schema: 'school.self-service-card/v2',
  learner: 'test-learner',
  learnerId: 'test-learner',
  subject: 'english',
  title: 'Reading log',
  sentence: null,
  context: {
    learner: { id: 'test-learner', displayName: 'Test-Learner' },
    taxonomy: { subject: { id: 'english', label: 'English & Literature' }, course: null, module: null, lesson: null },
    trail: [],
    progress: [],
  },
  presentation: { status: 'ready', message: null, ...presentation },
  actions,
});

const readingCard = (presentation = { openImmediately: true }) => card({
  actions: [READING_ACTION, EXIT_ACTION], presentation,
});

/** What `/act` answers for a program that mounts on this panel. */
const mountBody = {
  outcome: 'mount',
  sentence: null,
  effect: { kind: 'program', programId: 'book-log', learnerId: 'test-learner', bookGrant: 'grant-abc' },
};

function Panel() {
  const s = useSelfService({ idleTimeoutSeconds: 0, claim, onLaunch });
  if (s.view === 'keypad') {
    return <Keypad onSubmit={s.submit} busy={s.busy} message={s.message} degraded={s.degraded} onRetry={s.retry} onReload={s.reload} />;
  }
  return (
    <LaunchCard
      card={s.card}
      view={s.view}
      sentence={s.sentence}
      busy={s.busy}
      onAction={s.runAction}
      onConfirm={s.confirmPrint}
      onConfirmIdentity={s.confirmIdentity}
      onDenyIdentity={s.denyIdentity}
      onExit={s.exit}
    />
  );
}

const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};
const typeCode = async (code) => {
  for (const d of code) jab(d);
  await act(async () => { await vi.advanceTimersByTimeAsync(300 + 200); });
};

/** `/resolve` answers the card; `/act` answers the mount. */
const serve = (resolveBody, actBody = mountBody) => {
  global.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('/self-service/act') ? actBody : resolveBody),
  }));
};

const actCalls = () => (global.fetch.mock?.calls ?? [])
  .filter(([url]) => String(url).includes('/self-service/act'));

describe('a card with nothing to decide opens itself', () => {
  beforeEach(() => { vi.useFakeTimers(); claim.mockClear(); onLaunch.mockClear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('goes from the keypad to the shelf without rendering the card', async () => {
    serve(readingCard());
    render(<Panel />);
    await typeCode('204517');

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch.mock.calls[0][0]).toMatchObject({
      kind: 'program', program: 'book-log', learnerId: 'test-learner', bookGrant: 'grant-abc',
    });
    // The button the child never had to press.
    expect(screen.queryByRole('button', { name: /Open Reading/i })).toBeNull();
  });

  it('claims the learner BEFORE the thing it opens can record anything', async () => {
    serve(readingCard());
    render(<Panel />);
    await typeCode('204517');

    expect(claim).toHaveBeenCalledWith('test-learner');
    const claimOrder = claim.mock.invocationCallOrder[0];
    const launchOrder = onLaunch.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(launchOrder);
  });

  it('runs the work action and never the way out', async () => {
    serve(readingCard());
    render(<Panel />);
    await typeCode('204517');

    expect(actCalls()).toHaveLength(1);
    expect(JSON.parse(actCalls()[0][1].body).action).toBe('program');
  });

  it('still asks whose paper this is when the card says to', async () => {
    // A re-entered code. The question comes first; nothing is claimed and
    // nothing is opened until it is answered.
    serve(readingCard({ confirmIdentity: true }));
    render(<Panel />);
    await typeCode('204517');

    expect(claim).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(actCalls()).toHaveLength(0);
    expect(screen.getByTestId('selfservice-identity-yes')).toBeTruthy();
  });

  it('leaves an ordinary card exactly as it was', async () => {
    // No `openImmediately`: the card renders and waits to be tapped.
    serve(card({
      actions: [{ kind: 'print', label: 'Print it', role: 'primary', operation: 'print' }, EXIT_ACTION],
      presentation: {},
    }));
    render(<Panel />);
    await typeCode('482913');

    expect(actCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Print it/i })).toBeTruthy();
  });
});
