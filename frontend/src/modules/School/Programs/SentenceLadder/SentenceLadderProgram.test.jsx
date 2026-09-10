import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SentenceLadderProgram from './SentenceLadderProgram.jsx';

const dayMock = vi.fn();
const previewDayMock = vi.fn();
const logMock = vi.fn();
const rollMock = vi.fn();
const pacingMock = vi.fn();
const historyMock = vi.fn();
const {
  programLogMock, programStepMock, rungLogMock, pacingLogMock, pacingWarnMock, capabilityLogMock,
} = vi.hoisted(() => ({
  programLogMock: vi.fn(),
  programStepMock: vi.fn(),
  rungLogMock: vi.fn(),
  pacingLogMock: vi.fn(),
  pacingWarnMock: vi.fn(),
  capabilityLogMock: vi.fn(),
}));

vi.mock('./languageLog.js', () => ({
  languageLog: {
    program: (...args) => programLogMock(...args),
    programStep: (...args) => programStepMock(...args),
    programError: vi.fn(),
    rung: (...args) => rungLogMock(...args),
    attempt: vi.fn(),
    attemptError: vi.fn(),
    audio: vi.fn(),
    audioError: vi.fn(),
    capture: vi.fn(),
    captureError: vi.fn(),
    pacing: (...args) => pacingLogMock(...args),
    pacingWarn: (...args) => pacingWarnMock(...args),
    capability: (...args) => capabilityLogMock(...args),
    // The run-id holder. Real in `languageLog.js`; stubbed here because the
    // program mints a run during RENDER, so a mock missing these throws before
    // a single assertion runs.
    startRun: vi.fn(() => 'test-run'),
    setRun: vi.fn(),
    currentRun: vi.fn(() => 'test-run'),
    endRun: vi.fn(),
  },
}));

vi.mock('./languageApi.js', () => ({
  languageApi: {
    courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    day: (...a) => dayMock(...a),
    previewDay: (...a) => previewDayMock(...a),
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
  queue, chain = ['repetition'], day = 1, dailyLimit = 5,
  missingCreditRungs = [], missingCreditNeeds = {},
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
      missingCreditNeeds,
      rollover: { roll: false, reason: 'queue-incomplete' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  programLogMock.mockClear();
  programStepMock.mockClear();
  rungLogMock.mockClear();
  pacingLogMock.mockClear();
  pacingWarnMock.mockClear();
  capabilityLogMock.mockClear();
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

  it('runs a guest preview without a learner call, grant, or saved attempt', async () => {
    previewDayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'dictation')], chain: ['dictation'] }));
    render(<SentenceLadderProgram corpusId="glossika-korean" preview />);

    expect(await screen.findByText(/Guest preview, nothing is saved/i)).toBeTruthy();
    expect(dayMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Type what you hear/i), { target: { value: '한국어 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText(/Preview complete/i);
    expect(logMock).not.toHaveBeenCalled();
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
    // ONE statement of progress: the "1 left" and the bar are gone; the
    // ladder's rung carries the same fact as pips.
    expect(await screen.findByText('1 of 2 steps')).toBeTruthy();
    expect(screen.queryByText('1 left')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '1 of 2 session steps complete');
    expect(screen.getByTestId('ladder-pips-repetition')).toHaveAttribute('aria-label', '1 of 2 repetition sentences');
    expect(screen.getByTestId('ladder-pips-repetition').querySelectorAll('.reading-pip--done')).toHaveLength(1);
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

  it('renders a rung per mode in the chain, in order, each wearing its own pips', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation'), entry(3, 'dictation')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText('Dictation')).toBeTruthy();
    const rungs = screen.getByRole('navigation', { name: 'Session modes' }).querySelectorAll('.lang-ladder__step');
    expect([...rungs].map((r) => r.querySelector('.lang-ladder__label').textContent)).toEqual(['Repetition', 'Dictation']);
    // Two dictation sentences, none done: two hollow pips, no count to read.
    expect(screen.getByTestId('ladder-pips-dictation').querySelectorAll('.reading-pip')).toHaveLength(2);
    expect(screen.getByTestId('ladder-pips-dictation').querySelectorAll('.reading-pip--done')).toHaveLength(0);
    // No tab strip, no bar.
    expect(document.querySelector('.lang-tab')).toBeNull();
    expect(document.querySelector('.lang-program__progress-bar')).toBeNull();
  });

  it('a rung this device cannot climb says so on the rung, not in a banner', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'recording'],
      queue: [entry(1, 'repetition'), entry(2, 'recording')],
      missingCreditRungs: ['recording'],
      missingCreditNeeds: { recording: { kind: 'microphone' } },
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText(/Needs a microphone/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Recording' })).toHaveClass('is-blocked');
  });

  // The note on a dimmed rung was one hardcoded string, "Needs a microphone",
  // whatever the rung actually wanted. The tablet in the yellow room has a mic
  // and an English-only keyboard, so the rung it blocks is DICTATION — and the
  // card sent a child hunting for a microphone they were already holding.
  it('tells a keyboard-blocked rung to find a KEYBOARD, not a microphone', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'interpretation'],
      queue: [entry(1, 'repetition'), entry(2, 'interpretation')],
      missingCreditRungs: ['dictation'],
      missingCreditNeeds: { dictation: { kind: 'textInput', language: 'KR' } },
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText(/Needs a Korean keyboard/)).toBeTruthy();
    expect(screen.queryByText(/microphone/i)).toBeNull();
  });

  it('names the microphone when the microphone is what is missing', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition'), entry(2, 'dictation')],
      missingCreditRungs: ['recording'],
      missingCreditNeeds: { recording: { kind: 'microphone' } },
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText(/Needs a microphone/)).toBeTruthy();
    expect(screen.queryByText(/keyboard/i)).toBeNull();
  });

  it('will not print the word "null" at a child when the corpus cannot name its language', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition'],
      queue: [entry(1, 'repetition')],
      missingCreditRungs: ['dictation'],
      // `resolveRole` yields null for a corpus whose languages map is missing
      // the rung's role, and the requirement object around it is still truthy.
      missingCreditNeeds: { dictation: { kind: 'textInput', language: null } },
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText('Not available on this device')).toBeTruthy();
    expect(screen.queryByText(/null/i)).toBeNull();
  });

  it('draws the rung a mic-less device skips even when the chain omits it', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition'), entry(2, 'dictation')],
      missingCreditRungs: ['recording'],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    const labels = [...document.querySelectorAll('.lang-ladder__label')].map((el) => el.textContent);
    expect(labels).toEqual(['Repetition', 'Dictation', 'Recording']);
    expect(screen.getByRole('button', { name: 'Recording' })).toHaveAttribute('aria-disabled', 'true');
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
    // The key is DELETED, not defaulted: an older server, or any payload
    // predating `missingCreditNeeds`, is what the `?? {}` guard is for.
    const payload = dayPayload({ queue: [], missingCreditRungs: ['recording'] });
    delete payload.data.missingCreditNeeds;
    dayMock.mockResolvedValue(payload);
    render(
      <SentenceLadderProgram
        studyGrant="test-grant" userId="kckern" corpusId="glossika-korean"
        locked onExit={onExit}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent(/device that can complete Recording/i);
    // With no needs map at all, the rung still states its own condition rather
    // than dimming with no reason given.
    expect(screen.getByText('Not available on this device')).toBeTruthy();
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

// Repetition is the one rung with nothing to submit, so finishing it used to
// mean leaving it: the parent's queue put the NEXT sentence on screen and a
// timer played it 350ms later. A child who wanted the sentence they had just
// heard one more time had no way to ask for it. Finishing now HOLDS the
// sentence and offers the choice.
describe('repetition, one sentence at a time', () => {
  // jsdom fires no `ended` event, and the sequence machine advances on it.
  const playsToEnd = () => {
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
  };
  // The real loop: the server marks the attempt done and the program re-fetches
  // the day. A static payload would hide the swap this test exists to catch.
  const liveDay = (initial, chain = ['repetition']) => {
    let queue = initial;
    dayMock.mockImplementation(async () => dayPayload({ queue, chain }));
    logMock.mockImplementation(async (_userId, { seq, rung }) => {
      queue = queue.map((e) => (e.seq === seq && e.rung === rung ? { ...e, done: true } : e));
      return { ok: true, status: 200, data: {} };
    });
  };
  // A repetition sentence takes a real second to play — there is a deliberate
  // silence before the repeated target clip, which is where the child speaks.
  const SEQUENCE = { timeout: 4000 };

  it('holds the sentence it just played and offers repeat or move on', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    const again = await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);
    // Its word is for screen readers; a child sees the glyph, so there must be one.
    expect(again.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    // The sentence they just heard is still the one on screen.
    expect(screen.getByText('English 1')).toBeTruthy();
    expect(screen.queryByText('English 2')).toBeNull();
  });

  it('moves on only when the child says so — and Next means what it says', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    const before = window.HTMLMediaElement.prototype.play.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }, SEQUENCE));

    expect(await screen.findByText('English 2')).toBeTruthy();
    // Sounding already: the tap on Next is the gesture behind this sentence, so
    // asking the child to find Play as well would be two taps for one intention.
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy();
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play.mock.calls.length)
      .toBeGreaterThan(before));
  });

  it('waits to be asked for the first sentence of a rung', async () => {
    // Only a sentence arrived at VIA Next has a gesture behind it. Nothing may
    // sound on arrival at a rung — that is the auto-advance this replaced.
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
    await waitFor(() => expect(programLogMock).toHaveBeenCalledWith('day-loaded', expect.anything()));
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('starts an arrived-at sentence once, and logs it once', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition'), entry(3, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }, SEQUENCE));
    // Sentence 2 plays itself through to its own choice — one pass, one attempt.
    await screen.findByText('English 2');
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);
    expect(logMock.mock.calls.map(([, body]) => body.seq)).toEqual([1, 2]);
  });

  it('hands the last sentence of the day over to the complete panel', async () => {
    // Nothing to hold and nothing to play: the day is finished, and the panel
    // takes the stage — which is also why the replay control goes with it.
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }, SEQUENCE));
    expect(await screen.findByText(/Day 1 complete/i, {}, SEQUENCE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
    expect(logMock.mock.calls.map(([, body]) => body.seq)).toEqual([1, 2]);
  });

  it('replays without climbing the rung twice', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Play again' }, SEQUENCE));
    // It really plays again — and lands back on the same choice.
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);
    expect(screen.getByText('English 1')).toBeTruthy();
    // One pass over the sentence, one attempt recorded. A replay that logged
    // again would credit a sentence the child has already climbed.
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it('lets go of the held sentence when the child changes rung', async () => {
    playsToEnd();
    liveDay(
      [entry(1, 'repetition'), entry(2, 'repetition'), entry(3, 'dictation')],
      ['repetition', 'dictation'],
    );
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);

    fireEvent.click(screen.getByRole('button', { name: /Dictation/ }));
    expect(screen.getByLabelText(/Type what you hear/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Repetition/ }));
    // Back to the queue, not to a stale hold on a sentence already finished.
    expect(screen.getByText('English 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
  });

  // The choice this rung gained — hold, replay, move on — shipped unobservable:
  // a session read back as a run of `complete`s, with no way to tell a child who
  // asked to hear a sentence again from one being carried along by a timer.
  it('records holding, replaying and moving on as three different things', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);
    expect(rungLogMock).toHaveBeenCalledWith('held', { rung: 'repetition', seq: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(rungLogMock).toHaveBeenCalledWith('replayed', { rung: 'repetition', seq: 1 });
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(rungLogMock).toHaveBeenCalledWith('advanced', { rung: 'repetition', seq: 1 });
    // A replay is not a second climb, in the record as well as in the ledger.
    expect(rungLogMock.mock.calls.filter(([d]) => d === 'complete')).toHaveLength(1);
  });

  it('Stop actually stops', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    fireEvent.click(await screen.findByText('Play'));
    fireEvent.click(await screen.findByText('Stop'));
    expect(await screen.findByText('Play')).toBeTruthy();
  });
});

// Instrumentation is not decoration here: four children share these surfaces,
// and when one says "it didn't work" the only witness is the log store. Each of
// these transitions was silent, and each is a thing a child actually reports.
describe('what the store can answer afterwards', () => {
  it('records that a day was ASKED for, not only that one arrived', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], day: 4 }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText(/Day 4/);

    // A request that never comes back leaves "Loading…" on the wall and, until
    // now, nothing at all in the store — indistinguishable from a program
    // nobody opened. It carries the capabilities it asked WITH, because those
    // decide which rungs come back.
    expect(programStepMock).toHaveBeenCalledWith('day-loading', expect.objectContaining({
      corpus: 'glossika-korean', preview: false,
    }));
    const loaded = programLogMock.mock.calls.find(([detail]) => detail === 'day-loaded');
    expect(loaded[1]).toMatchObject({ day: 4, chain: ['repetition'], blocked: [] });
    expect(typeof loaded[1].ms).toBe('number');
  });

  it('records a move to the Review shelf, and says nothing about a tab already open', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(programStepMock).toHaveBeenCalledWith('tab', {
      corpus: 'glossika-korean', from: 'study', to: 'review',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(programStepMock.mock.calls.filter(([d]) => d === 'tab')).toHaveLength(1);
  });

  it('says WHY the learner landed on the rung they did', async () => {
    // Repetition finished earlier today: this is a return, not a start.
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);

    expect(rungLogMock).toHaveBeenCalledWith('landed', {
      rung: 'dictation', reason: 'resume', pending: 1, of: 1,
    });
  });

  it('records a dimmed rung once, naming the capability the server said was missing', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition'],
      queue: [entry(1, 'repetition')],
      missingCreditRungs: ['dictation'],
      missingCreditNeeds: { dictation: { kind: 'textInput', language: 'KR' } },
    }));
    const { rerender } = render(
      <SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />,
    );
    await screen.findByText(/Korean keyboard/);

    expect(capabilityLogMock).toHaveBeenCalledWith('rung-blocked', {
      corpus: 'glossika-korean', day: 1, rungs: ['dictation'],
      needs: { dictation: 'textInput:KR' },
    });
    // A rendered STATE, not an event: re-rendering it must not say it again.
    rerender(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    expect(capabilityLogMock.mock.calls.filter(([d]) => d === 'rung-blocked')).toHaveLength(1);
  });

  it('records the extra-practice banner it shows the child', async () => {
    // A day topped up with second passes over its own new sentences shows the
    // same sentence three times in a sitting — the most-reported "it repeated
    // itself" — and the surface said so to the child and to nobody else.
    dayMock.mockResolvedValue(dayPayload({
      queue: [entry(1, 'repetition', false, { practice: true })],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText(/Extra practice/);
    expect(rungLogMock).toHaveBeenCalledWith('practice', { rung: 'repetition', seq: 1 });
  });

  it('records a refused roll — a decline reads exactly like a dead button', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    rollMock.mockResolvedValue({ ok: true, status: 200, data: { rolled: false, reason: 'before-boundary' } });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('Start the next day'));
    await waitFor(() => expect(pacingWarnMock).toHaveBeenCalledWith('roll-refused', {
      corpus: 'glossika-korean', reason: 'before-boundary',
    }));
  });

  it('records a pacing change as from → to, and a failed one as a failure', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], dailyLimit: 5 }));
    pacingMock.mockResolvedValue({ ok: true, status: 200, data: { dailyLimit: 20 } });
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('5 / day'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '20' }));
    // "The limit is 20" does not tell you it used to be 5, and a limit quietly
    // raised is the usual explanation for a morning that became too long.
    await waitFor(() => expect(pacingLogMock).toHaveBeenCalledWith('changed', {
      corpus: 'glossika-korean', dailyLimit: 20, from: 5,
    }));

    pacingMock.mockResolvedValue({ ok: false, status: 503, data: null });
    fireEvent.click(screen.getByText('5 / day'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '10' }));
    await waitFor(() => expect(pacingWarnMock).toHaveBeenCalledWith('change-failed', {
      corpus: 'glossika-korean', dailyLimit: 10, from: 5, status: 503,
    }));
  });

  it('records a capability override with what it changed FROM', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByRole('button', { name: 'What this device can do' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Microphone/ }));
    // The single most consequential thing a grown-up can do here: it decides
    // which rungs exist tomorrow and persists in this browser until changed
    // back. The record has to be readable without diffing against an earlier
    // event to find out what moved.
    await waitFor(() => expect(capabilityLogMock).toHaveBeenCalledWith('overridden', expect.objectContaining({
      corpus: 'glossika-korean', changed: ['microphone'],
    })));
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
    // "Korean keyboard", not "KR keyboard": this panel is where a child lands
    // after a blocked rung tells them they need one, and for a while the note
    // said "Korean" while the row here said "KR" — the same object under two
    // names, two taps apart. Both read from `languageNames.js` now.
    expect(screen.getByText('Korean keyboard')).toBeTruthy();
    expect(screen.getByText('English keyboard')).toBeTruthy();
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
