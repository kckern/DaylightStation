import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SentenceLadderProgram from './SentenceLadderProgram.jsx';

const dayMock = vi.fn();
const logMock = vi.fn();
const rollMock = vi.fn();
const pacingMock = vi.fn();
const historyMock = vi.fn();
const { programLogMock } = vi.hoisted(() => ({ programLogMock: vi.fn() }));

vi.mock('./languageLog.js', () => ({
  languageLog: {
    program: (...args) => programLogMock(...args),
    programError: vi.fn(),
    rung: vi.fn(),
    attempt: vi.fn(),
    attemptError: vi.fn(),
    audio: vi.fn(),
    audioError: vi.fn(),
    capture: vi.fn(),
    captureError: vi.fn(),
    pacing: vi.fn(),
    capability: vi.fn(),
  },
}));

vi.mock('./languageApi.js', () => ({
  languageApi: {
    courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    day: (...a) => dayMock(...a),
    log: (...a) => logMock(...a),
    roll: (...a) => rollMock(...a),
    pacing: (...a) => pacingMock(...a),
    history: (...a) => historyMock(...a),
    recording: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    recordingBlob: vi.fn(async () => ({ ok: false, status: 404, data: null })),
    audioUrl: (c, seq, lang) => `/audio/${c}/${seq}/${lang}`,
    recordingUrl: (u, c, seq) => `/rec/${u}/${c}/${seq}`,
  },
}));

const LANGUAGES = { source: 'EN', target: 'KR' };

const entry = (seq, rung, done = false, options = {}) => ({
  seq,
  rung,
  done,
  text: { EN: `English ${seq}`, KR: `한국어 ${seq}` },
  prompt: rung === 'repetition'
    ? [{ role: 'source', language: 'EN' }, { role: 'target', language: 'KR' }, { role: 'target', language: 'KR' }]
    : [{ role: 'target', language: 'KR' }],
  response: rung === 'dictation' ? { role: 'target', modality: 'text', language: 'KR' }
    : rung === 'interpretation' ? { role: 'source', modality: 'text', language: 'EN' }
      : rung === 'recording' ? { role: 'target', modality: 'audio', language: 'KR' }
        : null,
  ...options,
});

function dayPayload({
  queue, chain = ['repetition'], day = 1, dailyLimit = 5, missingCreditRungs = [],
}) {
  const done = queue.filter((e) => e.done).length;
  return {
    ok: true,
    status: 200,
    data: {
      corpus: { id: 'glossika-korean', label: 'Glossika Korean', languages: LANGUAGES, size: 3000 },
      day,
      dailyLimit,
      chain,
      queue,
      summary: { total: queue.length, done, byRung: {} },
      missingCreditRungs,
      rollover: { roll: false, reason: 'queue-incomplete' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  programLogMock.mockClear();
  historyMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    data: { corpus: { languages: LANGUAGES }, days: [] },
  });
  window.localStorage.clear();
  // jsdom has no real audio pipeline; the drill only needs play() to resolve.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('identity', () => {
  it('refuses to drill a guest rather than discarding their work', async () => {
    render(<SentenceLadderProgram studyGrant="test-grant" userId={null} corpusId="glossika-korean" />);
    expect(await screen.findByText(/Sign in to study/i)).toBeTruthy();
    expect(dayMock).not.toHaveBeenCalled();
  });
});

describe('the day', () => {
  it('shows the day number and pacing', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], day: 7, dailyLimit: 10 }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText(/Day 7/)).toBeTruthy();
    expect(screen.getByText(/10 \/ day/)).toBeTruthy();
  });

  it('shows progress as done over total', async () => {
    dayMock.mockResolvedValue(dayPayload({
      queue: [entry(1, 'repetition', true), entry(2, 'repetition')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText('1 of 2 steps')).toBeTruthy();
    expect(screen.getByText('1 left')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '1 of 2 session steps complete');
  });

  it('emits one structured progress acknowledgement for an observable day state', async () => {
    dayMock.mockResolvedValue(dayPayload({
      queue: [entry(1, 'repetition', true), entry(2, 'repetition')], day: 7,
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    await waitFor(() => expect(programLogMock).toHaveBeenCalledWith('progress', {
      corpus: 'glossika-korean', day: 7, done: 1, total: 2,
      complete: false, empty: false, blockedByDevice: false,
    }));
    expect(programLogMock.mock.calls.filter(([detail]) => detail === 'progress')).toHaveLength(1);
  });

  it('renders a tab per rung in the chain, with an outstanding count', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation'), entry(3, 'dictation')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText('Dictation')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('lets a fully equipped session proceed through every offered mode', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation', 'recording', 'interpretation'],
      queue: [
        entry(1, 'repetition'), entry(2, 'dictation'),
        entry(3, 'recording'), entry(4, 'interpretation'),
      ],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    expect(await screen.findByText('English 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dictation/ }));
    expect(screen.getByLabelText(/Type what you hear/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Recording/ }));
    expect(screen.getByRole('button', { name: 'Listen, then record' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Interpretation/ }));
    expect(screen.getByLabelText(/Type what it means/i)).toBeTruthy();
  });

  it('reveals one target glyph ahead for an enrollment-owned copy dictation', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['dictation'],
      queue: [entry(1, 'dictation', false, { copyPrompt: true })],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    expect(await screen.findByText('한')).toBeTruthy();
    const input = screen.getByLabelText('Copy the sentence');
    fireEvent.change(input, { target: { value: '한' } });
    expect(screen.getByText('한국')).toBeTruthy();
    expect(screen.queryByText('한국어 1')).toBeNull();
  });

  it('NEVER renders a rung the device cannot perform', async () => {
    // The server omits `recording` from the chain when there is no mic. Even
    // if a stale entry rides along in the queue, no tab may offer it — that
    // dead input is the failure the capability system exists to prevent.
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'interpretation'],
      queue: [entry(1, 'repetition'), entry(2, 'recording')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.queryByText('Recording')).toBeNull();
  });

  it('lands on the first rung with work outstanding, not always the first rung', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    // Dictation's input, not repetition's Play button.
    expect(await screen.findByLabelText(/Type what you hear/i)).toBeTruthy();
  });

  it('surfaces a load failure with a retry instead of an empty screen', async () => {
    dayMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText(/Could not load/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('explains an empty day instead of rendering a blank study panel', async () => {
    const onExit = vi.fn();
    dayMock.mockResolvedValue(dayPayload({ queue: [] }));
    render(
      <SentenceLadderProgram
        studyGrant="test-grant" userId="kckern" corpusId="glossika-korean"
        locked onExit={onExit}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Nothing is due in this course today.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(programLogMock).toHaveBeenCalledWith('progress', expect.objectContaining({
      total: 0, done: 0, complete: true, empty: true, blockedByDevice: false,
    }));
  });

  it('keeps a device-blocked empty queue escapable without claiming completion', async () => {
    const onExit = vi.fn();
    dayMock.mockResolvedValue(dayPayload({ queue: [], missingCreditRungs: ['recording'] }));
    render(
      <SentenceLadderProgram
        studyGrant="test-grant" userId="kckern" corpusId="glossika-korean"
        locked onExit={onExit}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/device that can complete Recording/i);
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave for now' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(programLogMock).toHaveBeenCalledWith('progress', expect.objectContaining({
      complete: false, empty: true, blockedByDevice: true,
    }));
  });
});

describe('repetition', () => {
  it('shows both languages and plays on demand', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText('English 1')).toBeTruthy();
    expect(screen.getByText('한국어 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Play'));
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it('returns to Play when the browser blocks audio', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error('blocked')));
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(await screen.findByText(/Audio was blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
});

describe('recording', () => {
  it('returns to the start control when prompt audio is blocked', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error('blocked')));
    dayMock.mockResolvedValue(dayPayload({ chain: ['recording'], queue: [entry(1, 'recording')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Listen, then record' }));
    expect(await screen.findByText(/Audio was blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen, then record' })).toBeTruthy();
    expect(screen.queryByText('Listen…')).toBeNull();
  });
});

describe('repetition auto-advance', () => {
  it('requires the first tap, then runs hands-free', async () => {
    // The first tap is real — it grants the browser audio activation. What it
    // must not be is a tap per sentence, twenty times a sitting.
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    logMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('Play'));
    // Armed now: a later sentence shows the hands-free state, not a Play button.
    await waitFor(() => expect(screen.queryByText('Play')).toBeNull());
  });

  it('Stop actually stops — it does not immediately re-arm', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    fireEvent.click(await screen.findByText('Play'));
    fireEvent.click(await screen.findByText('Stop'));
    // Back to a deliberate Play, not the auto-advance countdown.
    expect(await screen.findByText('Play')).toBeTruthy();
    expect(screen.queryByText('Next…')).toBeNull();
  });
});

describe('typed rungs', () => {
  it('hides the sentence during dictation — recalling it IS the task', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    expect(screen.queryByText('한국어 1')).toBeNull();
  });

  it('SHOWS the sentence during interpretation — rendering meaning is the task', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['interpretation'], queue: [entry(1, 'interpretation')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what it means/i);
    expect(screen.getByText('한국어 1')).toBeTruthy();
  });

  it('submits the typed answer and re-fetches the day', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    logMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    const input = await screen.findByLabelText(/Type what you hear/i);
    fireEvent.change(input, { target: { value: '한국어 1' } });
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(logMock).toHaveBeenCalledWith('kckern', {
      corpus: 'glossika-korean', seq: 1, rung: 'dictation', given: '한국어 1',
    }, expect.anything(), 'test-grant'));
    // Re-fetched rather than mutating a local copy of the queue.
    await waitFor(() => expect(dayMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('will not submit an empty answer', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    fireEvent.click(screen.getByText('Submit'));
    expect(logMock).not.toHaveBeenCalled();
  });

  it('tells the learner when an answer was NOT saved', async () => {
    // Silence here is how a learner loses a session without knowing.
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    logMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    const input = await screen.findByLabelText(/Type what you hear/i);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText(/was not saved/i)).toBeTruthy();
  });
});

describe('day rollover', () => {
  it('offers the next day once everything is done', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Day 1 complete.*1 steps are saved.*School progress/i);
  });

  it('uses an honest leave affordance during a locked session and one Done after completion', async () => {
    const onExit = vi.fn();
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    const view = render(
      <SentenceLadderProgram
        studyGrant="test-grant" userId="kckern" corpusId="glossika-korean"
        locked onExit={onExit}
      />,
    );
    fireEvent.click(await screen.findByText('Leave for now'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Done')).toBeNull();

    view.unmount();
    onExit.mockClear();
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    render(
      <SentenceLadderProgram
        studyGrant="test-grant" userId="kckern" corpusId="glossika-korean"
        locked onExit={onExit}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByText('Leave for now')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('refuses an early roll and says why, rather than silently doing nothing', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    rollMock.mockResolvedValue({ ok: true, status: 200, data: { rolled: false, day: 1, reason: 'before-boundary' } });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('Start the next day'));
    expect(await screen.findByText(/Come back tomorrow/i)).toBeTruthy();
  });
});

describe('dismissal and dead ends', () => {
  it('closes the pacing menu when tapped away — the only escape on a touch panel', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    fireEvent.click(await screen.findByText('5 / day'));
    expect(screen.getByRole('menuitemradio', { name: '20' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(screen.queryByRole('menuitemradio', { name: '20' })).toBeNull();
  });

  it('gives a guest a way forward instead of a sentence of text', async () => {
    const onSignIn = vi.fn();
    render(<SentenceLadderProgram studyGrant="test-grant" userId={null} corpusId="glossika-korean" onSignIn={onSignIn} />);
    fireEvent.click(await screen.findByText('Sign in'));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('does not render its own back control — the School shell already has one', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('English 1');
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('hides keyboard shortcuts on a touch panel, shows them on a desktop', async () => {
    // Driven explicitly rather than trusting the test environment's ambient
    // matchMedia: the whole point is that the Portal and a laptop differ.
    const setPointer = (fine) => {
      window.matchMedia = (q) => ({
        matches: q.includes('pointer: fine') ? fine : false,
        media: q, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
      });
    };
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));

    setPointer(false);
    const touch = render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    expect(screen.queryByText(/Tab replays/)).toBeNull();
    touch.unmount();

    setPointer(true);
    window.localStorage.clear();
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    expect(screen.getByText(/Tab replays/)).toBeTruthy();
  });

  it('keeps device capabilities out of the drill surface', async () => {
    // They used to sit as 34px chips on the bottom edge — inside the Portal's
    // swipe-up zone. They now live behind a deliberate affordance.
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('English 1');
    expect(screen.queryByText('This device can type:')).toBeNull();
    fireEvent.click(screen.getByText('Device'));
    expect(screen.getByText('KR keyboard')).toBeTruthy();
    expect(screen.getByText('Microphone')).toBeTruthy();
  });

  it('lets the learner retry a failed history load', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    historyMock
      .mockResolvedValueOnce({ ok: false, status: 500, data: null })
      .mockResolvedValueOnce({
        ok: true, status: 200, data: { corpus: { languages: LANGUAGES }, days: [] },
      });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Could not load history.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing studied yet.')).toBeTruthy();
    expect(historyMock).toHaveBeenCalledTimes(2);
  });
});

describe('pacing', () => {
  it('changes the daily intake', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], dailyLimit: 5 }));
    pacingMock.mockResolvedValue({ ok: true, status: 200, data: { dailyLimit: 20 } });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('5 / day'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '20' }));
    await waitFor(() => expect(pacingMock).toHaveBeenCalledWith('kckern', 'glossika-korean', 20, 'test-grant'));
  });
});
