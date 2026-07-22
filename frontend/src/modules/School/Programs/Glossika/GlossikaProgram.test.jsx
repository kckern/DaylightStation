import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlossikaProgram from './GlossikaProgram.jsx';

const dayMock = vi.fn();
const logMock = vi.fn();
const rollMock = vi.fn();
const pacingMock = vi.fn();

vi.mock('./languageApi.js', () => ({
  languageApi: {
    courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    day: (...a) => dayMock(...a),
    log: (...a) => logMock(...a),
    roll: (...a) => rollMock(...a),
    pacing: (...a) => pacingMock(...a),
    history: vi.fn(async () => ({ ok: true, status: 200, data: { corpus: { languages: { source: 'EN', target: 'KR' } }, days: [] } })),
    recording: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
    audioUrl: (c, seq, lang) => `/audio/${c}/${seq}/${lang}`,
    recordingUrl: (u, c, seq) => `/rec/${u}/${c}/${seq}`,
  },
}));

const LANGUAGES = { source: 'EN', target: 'KR' };

const entry = (seq, rung, done = false) => ({
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
});

function dayPayload({ queue, chain = ['repetition'], day = 1, dailyLimit = 5 }) {
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
      rollover: { roll: false, reason: 'queue-incomplete' },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // jsdom has no real audio pipeline; the drill only needs play() to resolve.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('identity', () => {
  it('refuses to drill a guest rather than discarding their work', async () => {
    render(<GlossikaProgram userId={null} corpusId="glossika-korean" />);
    expect(await screen.findByText(/Sign in to study/i)).toBeTruthy();
    expect(dayMock).not.toHaveBeenCalled();
  });
});

describe('the day', () => {
  it('shows the day number and pacing', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], day: 7, dailyLimit: 10 }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText(/Day 7/)).toBeTruthy();
    expect(screen.getByText(/10 \/ day/)).toBeTruthy();
  });

  it('shows progress as done over total', async () => {
    dayMock.mockResolvedValue(dayPayload({
      queue: [entry(1, 'repetition', true), entry(2, 'repetition')],
    }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText('1 / 2')).toBeTruthy();
  });

  it('renders a tab per rung in the chain, with an outstanding count', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation'), entry(3, 'dictation')],
    }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.getByText('Dictation')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('NEVER renders a rung the device cannot perform', async () => {
    // The server omits `recording` from the chain when there is no mic. Even
    // if a stale entry rides along in the queue, no tab may offer it — that
    // dead input is the failure the capability system exists to prevent.
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'interpretation'],
      queue: [entry(1, 'repetition'), entry(2, 'recording')],
    }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    await screen.findByText('Repetition');
    expect(screen.queryByText('Recording')).toBeNull();
  });

  it('lands on the first rung with work outstanding, not always the first rung', async () => {
    dayMock.mockResolvedValue(dayPayload({
      chain: ['repetition', 'dictation'],
      queue: [entry(1, 'repetition', true), entry(2, 'dictation')],
    }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    // Dictation's input, not repetition's Play button.
    expect(await screen.findByLabelText(/Type what you hear/i)).toBeTruthy();
  });

  it('surfaces a load failure with a retry instead of an empty screen', async () => {
    dayMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText(/Could not load/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});

describe('repetition', () => {
  it('shows both languages and plays on demand', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')] }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText('English 1')).toBeTruthy();
    expect(screen.getByText('한국어 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Play'));
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });
});

describe('typed rungs', () => {
  it('hides the sentence during dictation — recalling it IS the task', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    expect(screen.queryByText('한국어 1')).toBeNull();
  });

  it('SHOWS the sentence during interpretation — rendering meaning is the task', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['interpretation'], queue: [entry(1, 'interpretation')] }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what it means/i);
    expect(screen.getByText('한국어 1')).toBeTruthy();
  });

  it('submits the typed answer and re-fetches the day', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    logMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);

    const input = await screen.findByLabelText(/Type what you hear/i);
    fireEvent.change(input, { target: { value: '한국어 1' } });
    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(logMock).toHaveBeenCalledWith('kckern', {
      corpus: 'glossika-korean', seq: 1, rung: 'dictation', given: '한국어 1',
    }));
    // Re-fetched rather than mutating a local copy of the queue.
    await waitFor(() => expect(dayMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('will not submit an empty answer', async () => {
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    await screen.findByLabelText(/Type what you hear/i);
    fireEvent.click(screen.getByText('Submit'));
    expect(logMock).not.toHaveBeenCalled();
  });

  it('tells the learner when an answer was NOT saved', async () => {
    // Silence here is how a learner loses a session without knowing.
    dayMock.mockResolvedValue(dayPayload({ chain: ['dictation'], queue: [entry(1, 'dictation')] }));
    logMock.mockResolvedValue({ ok: false, status: 500, data: null });
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);

    const input = await screen.findByLabelText(/Type what you hear/i);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Submit'));

    expect(await screen.findByText(/was not saved/i)).toBeTruthy();
  });
});

describe('day rollover', () => {
  it('offers the next day once everything is done', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);
    expect(await screen.findByText(/Today's set is done/)).toBeTruthy();
  });

  it('refuses an early roll and says why, rather than silently doing nothing', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition', true)] }));
    rollMock.mockResolvedValue({ ok: true, status: 200, data: { rolled: false, day: 1, reason: 'before-boundary' } });
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('Start the next day'));
    expect(await screen.findByText(/Come back tomorrow/i)).toBeTruthy();
  });
});

describe('pacing', () => {
  it('changes the daily intake', async () => {
    dayMock.mockResolvedValue(dayPayload({ queue: [entry(1, 'repetition')], dailyLimit: 5 }));
    pacingMock.mockResolvedValue({ ok: true, status: 200, data: { dailyLimit: 20 } });
    render(<GlossikaProgram userId="kckern" corpusId="glossika-korean" />);

    fireEvent.click(await screen.findByText('5 / day'));
    fireEvent.click(screen.getByRole('option', { name: '20' }));
    await waitFor(() => expect(pacingMock).toHaveBeenCalledWith('kckern', 'glossika-korean', 20));
  });
});
