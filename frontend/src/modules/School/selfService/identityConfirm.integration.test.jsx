/**
 * "Is this you?" — asked before a RE-ENTERED code claims anyone (2026-09-06).
 *
 * A code typed at this panel silently CLAIMS the learner it names: every
 * `code.resolved` in production was followed immediately by
 * `school.profile.claimed`, so whoever typed it became that child for
 * attribution and the logs could not say who was standing there. Identity here
 * is a soft, self-declared tap by design, and this does not change that — it is
 * a speed bump, not a lock, and anyone can tap yes.
 *
 * What it does change is ORDER. `claim` is what makes everything after it
 * record against the learner — a runner, the shelf mount, the day's history —
 * so the question is asked BEFORE it rather than after. A child who walks away
 * from the question, or says no, leaves the panel having recorded nothing
 * against anybody.
 *
 * Only on a re-entry. The first open of a fresh code each day is the honest
 * path and gets no friction at all; the backend sets
 * `presentation.confirmIdentity` from the record's own use count.
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

const cardBody = ({ confirmIdentity }) => ({
  ok: true,
  schema: 'school.self-service-card/v2',
  learner: 'user_4',
  learnerId: 'user_4',
  subject: 'english',
  title: 'English 1',
  sentence: null,
  context: {
    learner: { id: 'user_4', displayName: 'User_4' },
    taxonomy: { subject: { id: 'english', label: 'English & Literature' }, course: null, module: null, lesson: null },
    trail: [],
    progress: [],
  },
  presentation: { status: 'ready', message: null, ...(confirmIdentity ? { confirmIdentity: true } : {}) },
  actions: [{ kind: 'print', label: 'Print it', role: 'primary', operation: 'print', followUp: 'confirm-print' }],
});

function PanelBody({ s }) {
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

/** Same panel, with a real idle window so the timeout can be exercised. */
function PanelWithIdle() {
  return <PanelBody s={useSelfService({ idleTimeoutSeconds: 30, claim })} />;
}

function Panel() {
  const s = useSelfService({ idleTimeoutSeconds: 0, claim });
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

const serve = (body) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
};

describe('identity confirmation before the claim', () => {
  beforeEach(() => { vi.useFakeTimers(); claim.mockClear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('claims immediately when the card does not ask', async () => {
    serve(cardBody({ confirmIdentity: false }));
    render(<Panel />);
    await typeCode('482913');
    expect(claim).toHaveBeenCalledWith('user_4');
    expect(screen.queryByTestId('selfservice-identity-yes')).toBeNull();
  });

  it('asks first — and claims NOTHING until the child answers', async () => {
    serve(cardBody({ confirmIdentity: true }));
    render(<Panel />);
    await typeCode('482913');
    expect(screen.getByTestId('selfservice-identity-yes')).toBeInTheDocument();
    expect(screen.getByText(/Is this you, User_4\?/)).toBeInTheDocument();
    // THE POINT: attribution has not happened yet.
    expect(claim).not.toHaveBeenCalled();
  });

  it('claims on yes, and shows the card', async () => {
    serve(cardBody({ confirmIdentity: true }));
    render(<Panel />);
    await typeCode('482913');
    await act(async () => { fireEvent.click(screen.getByTestId('selfservice-identity-yes')); });
    expect(claim).toHaveBeenCalledWith('user_4');
    expect(screen.queryByTestId('selfservice-identity-yes')).toBeNull();
  });

  it('claims NOBODY on no, and returns to the keypad', async () => {
    serve(cardBody({ confirmIdentity: true }));
    render(<Panel />);
    await typeCode('482913');
    await act(async () => { fireEvent.click(screen.getByTestId('selfservice-identity-no')); });
    expect(claim).not.toHaveBeenCalled();
    // Back to an anonymous lock screen with nothing recorded and nothing shown.
    expect(screen.getByTestId('selfservice-entry')).toBeInTheDocument();
  });

  it('still asks when the card has no display name, without saying "you, undefined"', async () => {
    const body = cardBody({ confirmIdentity: true });
    body.context.learner = { id: 'user_4' };
    serve(body);
    render(<Panel />);
    await typeCode('482913');
    expect(screen.getByText('Is this you?')).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

describe('walking away from the question', () => {
  beforeEach(() => { vi.useFakeTimers(); claim.mockClear(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('Escape returns to the keypad having claimed nobody', async () => {
    serve(cardBody({ confirmIdentity: true }));
    render(<Panel />);
    await typeCode('482913');
    expect(screen.getByTestId('selfservice-identity-yes')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByTestId('selfservice-entry')).toBeInTheDocument();
  });

  it('the idle timeout does the same', async () => {
    // The identity view is not special-cased in the idle effect — it is armed
    // for every view but the keypad — and this pins that it stays that way.
    serve(cardBody({ confirmIdentity: true }));
    render(<PanelWithIdle />);
    await typeCode('482913');
    expect(screen.getByTestId('selfservice-identity-yes')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByTestId('selfservice-entry')).toBeInTheDocument();
  });
});
