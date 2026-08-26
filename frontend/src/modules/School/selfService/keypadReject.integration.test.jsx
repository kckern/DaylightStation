/**
 * The refusal, driven through the REAL composition: useSelfService's state
 * machine feeding the Keypad, with only `fetch` faked. Keypad-only tests can
 * hand the component a hand-written verdict; only this one proves the verdict
 * the hook actually produces for an unknown code still reaches the screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad, { REJECT_WORD } from './Keypad.jsx';
import { useSelfService } from './useSelfService.js';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

function Panel() {
  const s = useSelfService({ idleTimeoutSeconds: 0 });
  if (s.view !== 'keypad') return <div data-testid="card-open" />;
  return (
    <Keypad
      onSubmit={s.submit}
      busy={s.busy}
      message={s.message}
      degraded={s.degraded}
      onRetry={s.retry}
      onReload={s.reload}
    />
  );
}

const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};
const typeCode = (code) => { for (const d of code) jab(d); };
const entryText = () => screen.getByTestId('selfservice-entry').textContent;

/** What `/self-service/resolve` really answers for a code nobody knows. */
const UNKNOWN_CODE_BODY = {
  ok: false, reason: 'unknown_code', learner: null, subject: null, title: null,
  sentence: 'Try again.', actions: [],
};

describe('unknown code → NONONO, through the real hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => UNKNOWN_CODE_BODY,
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('animates the refusal and prints no sentence beside it', async () => {
    render(<Panel />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(300 + 1200); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(entryText()).toBe(REJECT_WORD);
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'rejected');
    // A wrong code says it in the slots. Words are for an outage only.
    expect(screen.queryByText('Try again.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('an impatient re-tap on the last key does not swallow the refusal', async () => {
    // The panel is a laggy WebView on a wall. A child who taps the sixth key
    // and sees nothing happen for 300ms taps it again — and by then
    // auto-submit has already emptied the entry, so that tap is a LIVE press
    // landing squarely on the animation it just earned.
    render(<Panel />);
    typeCode('12345');
    jab('6');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    jab('6');
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'rejected');
  });

  it('animates the SECOND wrong code too, not just the first', async () => {
    render(<Panel />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(300 + 2400); });
    typeCode('654321');
    await act(async () => { await vi.advanceTimersByTimeAsync(300 + 1200); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(entryText()).toBe(REJECT_WORD);
  });

  it('animates a code finished on the HID keyboard (Enter, ahead of the settle)', async () => {
    render(<Panel />);
    for (const d of '123456') {
      await act(async () => { fireEvent.keyDown(window, { key: d }); });
    }
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(entryText()).toBe(REJECT_WORD);
  });

  it('a backend outage gets words and a retry, never the animation', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => null,
    });
    render(<Panel />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(300 + 1200); });
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'entry');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
