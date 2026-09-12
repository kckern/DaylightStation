import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import SentenceLadderProgram from './SentenceLadderProgram.jsx';
import TypedRung from './rungs/TypedRung.jsx';
import HangulTypingProvider from '../../ime/HangulTypingProvider.jsx';
import ICONS from '../../home/icons/iconRegistry.js';

/**
 * The dictation surface is a grid, not a sentence: one column per syllable,
 * the model on the upper row and the learner's answer on the lower one. These
 * read a column rather than a string, because `getByText('한국')` — which is
 * how the old prefix-matching prompt was asserted — cannot tell a settled
 * glyph from a ghosted one, and that difference is the whole rung.
 */
/**
 * The stylesheet, as text. jsdom applies no external CSS, so the one rule on
 * this screen that would break the IME rather than merely look wrong —
 * whatever hides the dictation field — cannot be caught by a computed style.
 * It is asserted against the source instead.
 */
const SCSS_SOURCE = fs.readFileSync(new URL('./SentenceLadder.scss', import.meta.url), 'utf8');

const col = (i) => document.querySelectorAll('.lang-strip__col')[i];
const model = (i) => col(i).querySelector('.lang-strip__want').textContent;
const answer = (i) => col(i).querySelector('.lang-strip__got').textContent;

const dayMock = vi.fn();
const previewDayMock = vi.fn();
const logMock = vi.fn();
const rollMock = vi.fn();
const pacingMock = vi.fn();
const historyMock = vi.fn();
const {
  programLogMock, programStepMock, rungLogMock, rungLandedMock, pacingLogMock, pacingWarnMock,
  capabilityLogMock,
} = vi.hoisted(() => ({
  programLogMock: vi.fn(),
  programStepMock: vi.fn(),
  rungLogMock: vi.fn(),
  rungLandedMock: vi.fn(),
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
    rungLanded: (...args) => rungLandedMock(...args),
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

/**
 * IS THERE A KEYBOARD — asked with a lever, not inferred from a mouse.
 *
 * `lib/hardwareKeyboard.js` caches a found keyboard in MODULE state on purpose
 * and deliberately has no "no": one typing keystroke anywhere in this file
 * teaches it for every test that runs after. The shortcut test below was
 * reading that leak — it passed only because nothing above it had ever typed a
 * letter, and the moment a test drove the in-page IME with real `KeyD`-shaped
 * events, "hides shortcuts on a touch panel" started failing on ordering
 * rather than on behaviour. It now says what it means.
 */
const { keyboard } = vi.hoisted(() => ({ keyboard: { present: false } }));
vi.mock('../../../../hooks/useHardwareKeyboard.js', () => ({
  useHardwareKeyboard: () => keyboard.present,
  default: () => keyboard.present,
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
    cueUrl: (name) => `/cue/${name}`,
    recordingUrl: (u, c, seq) => `/rec/${u}/${c}/${seq}`,
  },
}));

const LANGUAGES = { source: 'EN', target: 'KR' };
/**
 * The registry's raw SVG, re-serialised by the DOM so it can be compared with
 * what `Icon` actually rendered. The files ship self-closing (`<path …/>`) and
 * jsdom serialises the same node as `<path …></path>`, so a raw string compare
 * fails on markup that is identical.
 */
function renderedIcon(name) {
  const host = document.createElement('div');
  host.innerHTML = ICONS[name];
  return host.innerHTML;
}

const RUNG_TITLES = {
  repetition: 'Repetition', dictation: 'Dictation',
  recording: 'Recording', interpretation: 'Interpretation',
};

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
  missingCreditRungs = [], missingCreditNeeds = {}, cues = [],
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
      cues,
      rollover: { roll: false, reason: 'queue-incomplete' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  programLogMock.mockClear();
  programStepMock.mockClear();
  rungLogMock.mockClear();
  rungLandedMock.mockClear();
  pacingLogMock.mockClear();
  pacingWarnMock.mockClear();
  capabilityLogMock.mockClear();
  keyboard.present = false;
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

  // THE RAIL WAS THE DEFECT, NOT THE STYLING. `ReadingPips` gives up and prints
  // its label past a cap that defaults to 8, and a day's pace is commonly 15 —
  // so every rung had ALWAYS rendered "0 of 15 repetition sentences" instead of
  // pips, at the component's default label size (4.4vh) in the accent green,
  // wrapping to three lines and pushing the Review shelf off a 1280x800 panel.
  // The rail had never drawn a single pip in its life.
  it('draws fifteen pips for a fifteen-sentence rung instead of printing the sentence', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition'],
      queue: Array.from({ length: 15 }, (_, i) => entry(i + 1, 'repetition', i < 4)),
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="test-learner" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    const pips = screen.getByTestId('ladder-pips-repetition');
    expect(pips.querySelectorAll('.reading-pip')).toHaveLength(15);
    expect(pips.querySelectorAll('.reading-pip--done')).toHaveLength(4);
    // The sentence survives as the accessible name and NOWHERE on the glass.
    expect(pips.getAttribute('aria-label')).toBe('4 of 15 repetition sentences');
    expect(document.querySelector('.reading-pips-label')).toBeNull();
  });

  // The cap is the RAIL's width, not a taste: sixteen pips no longer fit the
  // column, so a 20-a-day pace has to fall back to words rather than overflow.
  it('falls back to the count in words once a rung outgrows the rail', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition'],
      queue: Array.from({ length: 20 }, (_, i) => entry(i + 1, 'repetition', i < 2)),
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="test-learner" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    const pips = screen.getByTestId('ladder-pips-repetition');
    expect(pips).toHaveClass('reading-pips-label');
    expect(pips.textContent).toBe('2 of 20 repetition sentences');
    expect(document.querySelector('.reading-pip')).toBeNull();
  });

  // `Icon` marks itself with `school-icon` and the SVG body of the name it was
  // given — it emits no `data-icon` — so the icon a rung is actually wearing is
  // identified by matching that body against the registry. Asserting on the
  // class alone would pass with all four rungs wearing the same picture.
  it('says whose session this is, and marks each rung with its own icon', async () => {
    const rungs = ['repetition', 'dictation', 'recording', 'interpretation'];
    dayMock.mockResolvedValue(dayPayload({
      chain: rungs,
      queue: rungs.map((rung, i) => entry(i + 1, rung)),
    }));
    // `test-learner`, never a real child's name: this repo is public and a
    // pre-commit hook rejects household names in fixtures.
    const { container } = render(
      <SentenceLadderProgram studyGrant="test-grant" userId="test-learner" corpusId="glossika-korean" />,
    );
    expect(await screen.findByText('Test Learner')).toBeTruthy();
    for (const rung of rungs) {
      const step = [...container.querySelectorAll('.lang-ladder__step')]
        .find((el) => el.querySelector('.lang-ladder__label')?.textContent === RUNG_TITLES[rung]);
      expect(step.querySelector('.lang-ladder__glyph').innerHTML).toBe(renderedIcon(`rung-${rung}`));
    }
  });

  // A rung this device cannot climb is still one of the four. Dimming is the
  // only thing that may differ — a rung stripped of its mark would be the one
  // a child cannot recognise at all, which is backwards.
  it('keeps its mark on a rung this device cannot climb', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition'],
      queue: [entry(1, 'repetition')],
      missingCreditRungs: ['recording'],
      missingCreditNeeds: { recording: { kind: 'microphone' } },
    }));
    const { container } = render(
      <SentenceLadderProgram studyGrant="test-grant" userId="test-learner" corpusId="glossika-korean" />,
    );
    await screen.findByText('Recording');
    const blocked = container.querySelector('.lang-ladder__step.is-blocked');
    expect(blocked.querySelector('.lang-ladder__glyph').innerHTML).toBe(renderedIcon('rung-recording'));
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

    const input = await screen.findByLabelText('Copy the sentence');
    // One column per syllable of 한국어 1, the live one plus exactly one
    // ghosted next; everything past that is not drawn.
    expect(model(0)).toBe('한');
    expect(col(0).className).toContain('is-current');
    expect(col(1).className).toContain('is-next');
    expect(col(2).className).toContain('is-hidden');

    fireEvent.change(input, { target: { value: '한' } });
    expect(col(0).className).toContain('is-done');
    expect(answer(0)).toBe('한');
    expect(col(1).className).toContain('is-current');
    expect(col(2).className).toContain('is-next');
    // The sentence is columns, never one run of text — a `getByText` for the
    // whole thing is how the old prefix-matching prompt was asserted.
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
  // jsdom has no microphone, no MediaRecorder and no Web Audio. The rung is
  // written to run without the last (the band stays a baseline); the first two
  // are stood in for here, minimally: a stream with tracks to stop, and a
  // recorder whose stop() delivers one chunk and fires onstop.
  /**
   * A take has a LENGTH now — the rung refuses anything under MIN_TAKE_MS, so a
   * recorder that stops in the same millisecond it started is refused, exactly
   * as a real tapped-through take would be. `hold` is how long the fake take
   * appears to run; the clock is nudged rather than the test made to wait.
   */
  const fakeClock = () => {
    const real = Date.now;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => real() + offset);
    return { advance: (ms) => { offset += ms; } };
  };
  const fakeMic = () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    class FakeRecorder {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; FakeRecorder.last = this; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['take'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    window.MediaRecorder = FakeRecorder;
    window.URL.createObjectURL = vi.fn(() => 'blob:take');
    window.URL.revokeObjectURL = vi.fn();
    window.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    return { track, stream, FakeRecorder };
  };
  // Every media element finishes as soon as it starts, and remembers its src,
  // so a test can read the sequence back in order.
  const playsToEnd = () => {
    const played = [];
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      played.push(this.src);
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
    return played;
  };
  const recordingDay = (cues = ['record']) => dayMock.mockResolvedValue(
    dayPayload({ chain: ['recording'], queue: [entry(1, 'recording')], cues }),
  );
  const renderRung = () => render(
    <SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />,
  );
  const pressKey = (key) => fireEvent.keyDown(document.body, { key });

  it('returns to the start control when prompt audio is blocked', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error('blocked')));
    recordingDay();
    renderRung();

    fireEvent.click(await screen.findByRole('button', { name: 'Listen, then record' }));
    expect(await screen.findByText(/sound didn’t start/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen, then record' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('runs sentence → ding → live mic from one tap, and plays the take straight back', async () => {
    const played = playsToEnd();
    const { track } = fakeMic();
    recordingDay();
    renderRung();

    fireEvent.click(await screen.findByRole('button', { name: 'Listen, then record' }));
    // The mic goes live on its own once the ding has sounded — no second tap.
    const stop = await screen.findByRole('button', { name: 'Stop' });
    expect(played.map((u) => u.replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/audio/glossika-korean/1/KR', '/cue/record']);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByTestId('voice-band')).toBeTruthy();

    fireEvent.click(stop);
    // The mic is let go between takes, the take sounds without a player, and
    // then — and only then — the choice appears.
    expect(track.stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Keep it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy();
    expect(played.at(-1)).toBe('blob:take');
    expect(document.querySelector('audio[controls]')).toBeNull();
  });

  it('leaves the ding out when the household has not configured one', async () => {
    const played = playsToEnd();
    fakeMic();
    recordingDay([]);
    renderRung();

    fireEvent.click(await screen.findByRole('button', { name: 'Listen, then record' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(played.map((u) => u.replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/audio/glossika-korean/1/KR']);
  });

  it('is driven start to finish by Space, with Backspace for another take', async () => {
    const played = playsToEnd();
    fakeMic();
    recordingDay();
    renderRung();
    const { languageApi } = await import('./languageApi.js');

    // This test is about the KEYS, so the take has to be one the rung would
    // accept: long enough to be a sentence. Loudness is not judged here because
    // happy-dom has no AudioContext, so no level is ever reported and the rung
    // deliberately declines to rule on what it could not measure.
    const clock = fakeClock();
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    clock.advance(5000);
    pressKey(' ');
    await screen.findByRole('button', { name: 'Keep it' });

    // Again is the ding and the mic, not the whole sentence over.
    const before = played.length;
    pressKey('Backspace');
    await screen.findByRole('button', { name: 'Stop' });
    expect(played.slice(before).map((u) => u.replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/cue/record']);

    clock.advance(5000);
    pressKey('Enter');
    await screen.findByRole('button', { name: 'Keep it' });
    pressKey(' ');
    await waitFor(() => expect(languageApi.recording).toHaveBeenCalledTimes(1));
    Date.now.mockRestore?.();
    const [, corpus, seq, blob] = languageApi.recording.mock.calls[0];
    expect([corpus, seq]).toEqual(['glossika-korean', 1]);
    expect(blob).toBeInstanceOf(Blob);
  });

  /**
   * A rung that accepts anything can be tapped through. Production, 2026-09-11:
   * six takes, the last two ~1s each with `heard: false`, one accepted a second
   * after it stopped. Recording was being spent rather than done.
   */
  it('refuses a take too short to be a sentence, and will not let it be kept', async () => {
    playsToEnd();
    fakeMic();
    recordingDay();
    renderRung();
    const { languageApi } = await import('./languageApi.js');

    fireEvent.click(await screen.findByRole('button', { name: 'Listen, then record' }));
    // Stopped in the same instant it started — no clock advance at all.
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(await screen.findByText(/too quick/i)).toBeInTheDocument();
    const keep = await screen.findByRole('button', { name: 'Keep it' });
    expect(keep).toBeDisabled();

    // And the keyboard cannot get past it either — `accept` is gated at the
    // callback, not only by the tile being disabled.
    pressKey(' ');
    await new Promise((r) => setTimeout(r, 0));
    expect(languageApi.recording).not.toHaveBeenCalled();
  });

  it('leaves the keys alone while a control has focus', async () => {
    playsToEnd();
    fakeMic();
    recordingDay();
    renderRung();

    const startButton = await screen.findByRole('button', { name: 'Listen, then record' });
    startButton.focus();
    // Native activation handles Enter on a focused button; the rung must not
    // start a second sequence underneath it.
    fireEvent.keyDown(startButton, { key: 'Enter' });
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Listen, then record' })).toBeTruthy();
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

    // At INFO, unlike everything else this rung logs: debug is dropped at
    // ingest, and "which rung, and why" has to survive to the store.
    expect(rungLandedMock).toHaveBeenCalledWith({
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

// The dictation clip used to LOOP until submit, and it started on the learner's
// first keystroke. A child typing one Hangul syllable at a time got the same
// sentence over and over, with no stop control anywhere on the screen. These
// tests pin the replacement: one pass on arrival, a Stop the learner can reach,
// and a single gentle replay if they go quiet.
describe('typed rung audio', () => {
  const dictationDay = () => dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] });
  const playMock = () => window.HTMLMediaElement.prototype.play;
  // A clip that actually finishes, so a loop would have somewhere to restart
  // from and the idle wait has a silence to measure.
  const playsToEnd = () => {
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
  };
  const renderDictation = () => render(
    <SentenceLadderProgram studyGrant="test-grant" userId="test-learner" corpusId="glossika-korean" />,
  );

  it('plays once on arrival and never loops', async () => {
    playsToEnd();
    dayMock.mockResolvedValue(dictationDay());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderDictation();
      await screen.findByLabelText(/Type what you hear/i);
      // No keystroke, no tap: arriving on the rung is what plays it.
      await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
      // Far past LOOP_GAP_MS (2.5s), well short of the idle replay (30s).
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat Space as a play key', async () => {
    dayMock.mockResolvedValue(dictationDay());
    renderDictation();
    const input = await screen.findByLabelText(/Type what you hear/i);
    await waitFor(() => expect(playMock()).toHaveBeenCalled());

    // 오늘 온 사람 — a Korean sentence needs its spaces, and a Space bound to
    // "play" only while the field is empty is a trap the child cannot see.
    const before = playMock().mock.calls.length;
    const notPrevented = fireEvent.keyDown(input, { key: ' ' });
    expect(notPrevented).toBe(true);
    expect(playMock().mock.calls.length).toBe(before);
  });

  it('offers a Stop while the clip sounds, and Play again once it is stopped', async () => {
    dayMock.mockResolvedValue(dictationDay());
    renderDictation();
    await screen.findByLabelText(/Type what you hear/i);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy();
  });

  it('replays once when the learner has gone quiet, and a keystroke restarts the wait', async () => {
    playsToEnd();
    dayMock.mockResolvedValue(dictationDay());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderDictation();
      const input = await screen.findByLabelText(/Type what you hear/i);
      await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());

      await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);

      fireEvent.change(input, { target: { value: '한' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(playMock()).toHaveBeenCalledTimes(2);
      // ONE replay, not a loop that has merely been slowed down.
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(playMock()).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry on a timer when the browser blocked the audio', async () => {
    // A panel nobody has touched yet fails the autoplay gate. Retrying every
    // 30s would be silent and would beat a warn into the log store forever.
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new Error('blocked')));
    dayMock.mockResolvedValue(dictationDay());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderDictation();
      expect(await screen.findByText(/Audio was blocked/i)).toBeTruthy();
      expect(playMock()).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // STOP MEANS QUIET, NOT "QUIET FOR THIRTY SECONDS". A learner who silences the
  // sentence has said the audio is in their way; bringing it back on a timer
  // re-imposes the thing they just refused — the loop again, in slower clothes.
  it('stays quiet after Stop, and comes back the moment it is asked for', async () => {
    playsToEnd();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <TypedRung
          entry={entry(1, 'dictation')}
          audioUrl={(seq, lang) => `/audio/${seq}/${lang}`}
          onComplete={() => {}}
          saving={false}
          idleReplayMs={30_000}
        />,
      );
      await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop/i })); });
      // Well past the idle interval, twice over: the silence holds.
      await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);

      // Tab is the ask, and the ask un-hushes it.
      await act(async () => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' }); });
      await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a zero idle interval turns the replay off completely', async () => {
    playsToEnd();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <TypedRung
          entry={entry(1, 'dictation')}
          audioUrl={(seq, lang) => `/audio/${seq}/${lang}`}
          onComplete={() => {}}
          saving={false}
          idleReplayMs={0}
        />,
      );
      await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(playMock()).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// THE SEAM THE WHOLE SURFACE RESTS ON. The strip is fed the IME's COMMITTED
// prefix, never the field's value. Wired to `value` it looks correct in every
// test that types one precomposed syllable at a time and falls apart under a
// real keyboard, which is the only way a child ever uses it.
describe('the typing surface', () => {
  const rung = (options) => render(
    <HangulTypingProvider>
      <TypedRung
        entry={entry(1, 'dictation', false, { text: { EN: 'today', KR: '오늘' }, ...options })}
        audioUrl={(seq, lang) => `/audio/${seq}/${lang}`}
        onComplete={() => {}}
        saving={false}
        idleReplayMs={0}
      />
    </HangulTypingProvider>,
  );
  // 두벌식 on a physical keyboard, which is what the Portal has: one jamo per
  // key, matched on `code` because Android's reported `key` follows whatever
  // layout it thinks is attached.
  const typeJamo = (el, keys) => {
    for (const ch of keys) act(() => { fireEvent.keyDown(el, { code: `Key${ch.toUpperCase()}`, key: ch }); });
  };

  it('keeps the glyph being typed on screen through an ambiguous syllable', () => {
    rung({ copyPrompt: true });
    const input = screen.getByLabelText('Copy the sentence');
    // Blur first: the rung focuses itself in a mount effect, and a child's
    // effects run BEFORE its parents', so in a test that mounts the provider
    // and the rung together the provider's focusin listener is not registered
    // yet and never sees that first focus. In the app the provider has been
    // mounted since the shell loaded, so this is a test artefact — but without
    // it the field never declares Korean and nothing composes.
    act(() => { input.blur(); input.focus(); });

    // d h → ㅇ ㅗ → 오. Then s → ㄴ, and the FIELD now spells 온: a real word,
    // one glyph, and not the 오 the learner is typing. Only the next vowel
    // decides whether that ㄴ closed 오 or opened 늘.
    typeJamo(input, 'dhs');
    expect(input.value).toBe('온');

    // Nothing has SETTLED, so column 0 has not moved: 오 is still drawn, still
    // the live column, still not wrong. Fed the field value instead, the strip
    // would call column 0 settled-and-wrong, redden it, jump the caret to
    // column 1 — and undo all of it one keystroke later.
    expect(model(0)).toBe('오');
    expect(col(0).className).toContain('is-current');
    expect(col(0).className).not.toContain('is-wrong');
    expect(answer(0)).toBe('온');

    // m f → ㅡ ㄹ. The ㄴ leaves 오 for the next syllable, 오 settles, and the
    // caret moves exactly once — when the ambiguity resolved.
    typeJamo(input, 'mf');
    expect(input.value).toBe('오늘');
    expect(col(0).className).toContain('is-done');
    expect(answer(0)).toBe('오');
    expect(col(1).className).toContain('is-current');
    expect(answer(1)).toBe('늘');
  });

  it('does not print the model above a syllable the learner already typed, in listen mode', async () => {
    // A SETTLED COLUMN IS STILL SUBJECT TO `reveal`. It used to render its
    // target glyph whatever reveal said, so in listen mode every committed
    // syllable printed the correct one above the learner's — right or WRONG.
    // Typing anything at all walked the hidden sentence out one glyph at a
    // time, to be copied back before Submit. Found by rendering the rung; no
    // assertion anywhere covered `reveal: 'none'` with committed text in it.
    rung();
    const input = screen.getByLabelText('Type what you hear');
    await act(async () => { fireEvent.change(input, { target: { value: '우' } }); });
    expect(answer(0)).toBe('우');
    expect(col(0).className).toContain('is-wrong');
    expect(model(0)).toBe('');
    // Not merely invisible — not in the document. The strip is the only thing
    // on this screen that knows the sentence.
    expect(document.body.textContent).not.toContain('오');
  });

  it('parks the field offscreen rather than hiding it, so the IME keeps its selection', () => {
    // `display:none` and `visibility:hidden` both take an element out of the
    // selection APIs, and `FieldComposer.#continuous` reads `selectionStart`
    // on every keystroke — so either one strands every half-composed syllable.
    rung({ copyPrompt: true });
    const input = screen.getByLabelText('Copy the sentence');
    expect(input.className).toContain('is-offscreen');
    const css = SCSS_SOURCE.slice(SCSS_SOURCE.indexOf('&__input.is-offscreen'));
    const rule = css.slice(0, css.indexOf('}'));
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
    expect(rule).toMatch(/position:\s*absolute/);
  });
});

// GLYPH-PACED AUDIO. The sentence is paced by the learner's own progress, so a
// syllable landing in the right column replays the clip — the model arrives at
// the speed they are working, and doubles as "yes, that one".
describe('glyph-paced audio', () => {
  const playMock = () => window.HTMLMediaElement.prototype.play;
  const rung = (options) => render(
    <TypedRung
      entry={entry(1, 'dictation', false, { text: { EN: 'one', KR: '한국' }, ...options })}
      audioUrl={(seq, lang) => `/audio/${seq}/${lang}`}
      onComplete={() => {}}
      saving={false}
      idleReplayMs={0}
    />,
  );

  it('replays once each time a syllable is committed correctly, in copy mode', async () => {
    rung({ copyPrompt: true });
    const input = screen.getByLabelText('Copy the sentence');
    // Arrival is one play, and everything below is counted against it.
    await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));

    await act(async () => { fireEvent.change(input, { target: { value: '한' } }); });
    expect(playMock()).toHaveBeenCalledTimes(2);

    await act(async () => { fireEvent.change(input, { target: { value: '한국' } }); });
    expect(playMock()).toHaveBeenCalledTimes(3);

    // A WRONG glyph is not a replay. The clip is the reward for landing the
    // syllable, so firing it here would make it mean nothing.
    await act(async () => { fireEvent.change(input, { target: { value: '한국어' } }); });
    expect(playMock()).toHaveBeenCalledTimes(3);

    // Backspacing back over settled text must not re-fire on the way forward
    // from a stale high-water mark either.
    await act(async () => { fireEvent.change(input, { target: { value: '한국' } }); });
    expect(playMock()).toHaveBeenCalledTimes(3);
  });

  it('does not replay on progress in listen mode', async () => {
    // THE TARGET IS HIDDEN HERE ON PURPOSE. Replaying the clip whenever the
    // learner is correct tells them they are correct, which IS the exercise —
    // a drill that looks like it is working while measuring nothing. No green
    // assertion anywhere else in this file would have caught it.
    rung();
    const input = screen.getByLabelText('Type what you hear');
    await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));

    await act(async () => { fireEvent.change(input, { target: { value: '한' } }); });
    await act(async () => { fireEvent.change(input, { target: { value: '한국' } }); });
    expect(playMock()).toHaveBeenCalledTimes(1);
  });

  it('stays silenced: a correct syllable does not undo a Stop', async () => {
    // Stop means quiet until explicitly asked. A learner who silenced the
    // sentence did not ask for it back by typing well, and letting progress
    // re-arm it is the loop coming back through a side door.
    rung({ copyPrompt: true });
    const input = screen.getByLabelText('Copy the sentence');
    await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(1));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    await act(async () => { fireEvent.change(input, { target: { value: '한' } }); });
    expect(playMock()).toHaveBeenCalledTimes(1);

    // Tab is the ask, and the ask brings it back.
    await act(async () => { fireEvent.keyDown(input, { key: 'Tab' }); });
    await waitFor(() => expect(playMock()).toHaveBeenCalledTimes(2));
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

    // The next day is offered on the kiosk as well. Without it a finished day
    // was a wall: the child could only leave, never go on.
    rollMock.mockResolvedValue({ ok: true, status: 200, data: { rolled: true, day: 2, reason: 'ahead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start the next day' }));
    await waitFor(() => expect(rollMock).toHaveBeenCalledTimes(1));
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
    // Driven explicitly rather than trusting an ambient signal: the whole point
    // is that the Portal and a laptop differ, and the hint now rides ON the
    // play control rather than in a hint line of its own.
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));

    keyboard.present = false;
    const touch = render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    expect(screen.queryByText(/Tab plays/)).toBeNull();
    touch.unmount();

    keyboard.present = true;
    window.localStorage.clear();
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    // On the control it triggers, and out of that control's accessible name.
    // Asserted through the hint's own node rather than by asking for the
    // button BY name: that name is "Play" until the arrival clip has started
    // and "Play again" after, so a name-based assertion here races the effect
    // that `findByLabelText` above does not wait for — which is a flake under
    // a loaded suite and says nothing about where the hint lives.
    const hint = screen.getByText(/Tab plays/);
    expect(hint.closest('button')).toBeTruthy();
    expect(hint.getAttribute('aria-hidden')).toBe('true');
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

// Day one on the Portal: a keyboard in a child's lap, and Space did nothing on
// the repetition rung. Every step of the ladder is now reachable without the
// glass — the rungs by their own keys, the shell by arrows.
describe('hands-free', () => {
  const pressKey = (key) => fireEvent.keyDown(document.body, { key });
  const playsToEnd = () => {
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
  };
  const liveDay = (initial, chain = ['repetition']) => {
    let queue = initial;
    dayMock.mockImplementation(async () => dayPayload({ queue, chain }));
    logMock.mockImplementation(async (_userId, { seq, rung }) => {
      queue = queue.map((e) => (e.seq === seq && e.rung === rung ? { ...e, done: true } : e));
      return { ok: true, status: 200, data: {} };
    });
  };
  const SEQUENCE = { timeout: 4000 };

  it('Space plays, Space moves on, Backspace plays again — on the repetition rung', async () => {
    playsToEnd();
    liveDay([entry(1, 'repetition'), entry(2, 'repetition')]);
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);

    await screen.findByRole('button', { name: 'Play' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Play again' }, SEQUENCE);

    const before = window.HTMLMediaElement.prototype.play.mock.calls.length;
    pressKey('Backspace');
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play.mock.calls.length).toBeGreaterThan(before));
    await screen.findByRole('button', { name: 'Next' }, SEQUENCE);

    pressKey(' ');
    expect(await screen.findByText('English 2')).toBeTruthy();
  });

  it('Space stops a sentence that is sounding', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByRole('button', { name: 'Play' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    pressKey(' ');
    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('a typed rung is focused on arrival, and the sentence sounds without a key being touched', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    const input = await screen.findByLabelText(/Type what you hear/i);
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(input.value).toBe('');
  });

  it('the arrows walk the ladder, and reach the Review shelf', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition'), entry(1, 'dictation')],
    }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    await screen.findByRole('button', { name: 'Play' });

    pressKey('ArrowDown');
    expect(await screen.findByLabelText(/Type what you hear/i)).toBeTruthy();
    // The field takes focus, so the next arrow belongs to the field, not the
    // shell — step off it first, as a child would by tapping the stage.
    document.activeElement.blur();
    pressKey('ArrowDown');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review' }).getAttribute('aria-pressed')).toBe('true'));
    pressKey('ArrowDown');
    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
    pressKey('ArrowUp');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('Enter on the complete panel starts the next day', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    render(<SentenceLadderProgram studyGrant="test-grant" userId="kckern" corpusId="glossika-korean" />);
    rollMock.mockResolvedValue({ ok: true, status: 200, data: { rolled: true } });
    await screen.findByRole('button', { name: 'Start the next day' });
    pressKey('Enter');
    await waitFor(() => expect(rollMock).toHaveBeenCalled());
  });
});
