import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SayItem from './SayItem.jsx';
import { playClip } from '../wordLadderAudio.js';
import { wordLadderLog } from '../wordLadderLog.js';

vi.mock('../wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));

// SayItem talks to the real microphone through `useTakeRecorder`. The item's
// own behaviour — what it shows before/after a take, that Next/Skip is never
// gated, that a take is uploaded — is independent of the recorder's internal
// judging (covered by useTakeRecorder.test.js), so the recorder is mocked
// here and its `onTake` captured so a test can fire a "take arrived" the same
// way the real hook would, without touching a microphone.
const captured = vi.hoisted(() => ({ onTake: null }));
const recorderState = vi.hoisted(() => ({ phase: 'idle', verdict: null }));
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn((opts) => {
    captured.onTake = opts.onTake;
    return {
      start: vi.fn(async () => {}),
      stop: vi.fn(() => {}),
      phase: recorderState.phase,
      verdict: recorderState.verdict,
      stream: null,
      onLevel: vi.fn(),
    };
  }),
}));

const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', media: { audio: 'aud-gawi' } };
const langs = { term: 'ko', gloss: 'en' };

function makeApi(overrides = {}) {
  return { uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { done: true } })), ...overrides };
}

beforeEach(() => {
  recorderState.phase = 'idle';
  recorderState.verdict = null;
  captured.onTake = null;
  window.URL.createObjectURL = vi.fn(() => 'blob:take');
  window.URL.revokeObjectURL = vi.fn();
  playClip.mockClear();
});

describe('SayItem — Next is never a gate', () => {
  it('say-after: Skip is available and sends {done:true} before any take', () => {
    const onRespond = vi.fn();
    render(
      <SayItem
        item={{ id: 's1', type: 'say', mode: 'say-after', wordId: 'gawi', word, assets: { audio: 'aud-gawi' } }}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={onRespond}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    const skip = screen.getByRole('button', { name: /skip/i });
    expect(skip).not.toBeDisabled();
    fireEvent.click(skip);
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('Space sends {done:true} with no take made', () => {
    const onRespond = vi.fn();
    render(
      <SayItem
        item={{ id: 's2', type: 'say', mode: 'read-aloud', wordId: 'gawi', word }}
        mode="read-aloud"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={onRespond}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });
});

describe('SayItem — say-after', () => {
  it('shows the term and plays the native audio on arrival', () => {
    render(
      <SayItem
        item={{ id: 's3', type: 'say', mode: 'say-after', wordId: 'gawi', word, assets: { audio: 'aud-gawi' } }}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.getByText('가위')).toBeInTheDocument();
    expect(playClip).toHaveBeenCalledWith('aud-gawi');
  });
});

describe('SayItem — read-aloud', () => {
  it('shows the term but plays no audio on arrival', () => {
    render(
      <SayItem
        item={{ id: 's4', type: 'say', mode: 'read-aloud', wordId: 'gawi', word }}
        mode="read-aloud"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.getByText('가위')).toBeInTheDocument();
    expect(playClip).not.toHaveBeenCalled();
  });
});

describe('SayItem — say-from-cue', () => {
  const item = {
    id: 's5', type: 'say', mode: 'say-from-cue', wordId: 'gawi', word, cue: { type: 'text', text: 'Scissors' }, assets: { audio: 'aud-gawi' },
  };

  it('renders no term before the take — only the cue', () => {
    render(
      <SayItem
        item={item}
        mode="say-from-cue"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(screen.queryByText('가위')).toBeNull();
  });

  it('reveals the term after a take, playing the take then the native word', async () => {
    render(
      <SayItem
        item={item}
        mode="say-from-cue"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.queryByText('가위')).toBeNull();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(screen.getByText('가위')).toBeInTheDocument();
    expect(playClip.mock.calls.map((c) => c[0])).toEqual(['blob:take', 'aud-gawi']);
  });
});

describe('SayItem — uploads and Next/Skip wording', () => {
  it('uploads the take via api.uploadRecording, and Next replaces Skip', async () => {
    const api = makeApi();
    const onRespond = vi.fn();
    render(
      <SayItem
        item={{ id: 's6', type: 'say', mode: 'say-after', wordId: 'gawi', word, assets: { audio: 'aud-gawi' } }}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={onRespond}
        api={api}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(api.uploadRecording).toHaveBeenCalledWith('sit1', { userId: 'kid', itemId: 's6', blob });
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('an upload failure logs recording.failed and never blocks Next', async () => {
    const spy = vi.spyOn(wordLadderLog, 'recordingFailed').mockImplementation(() => {});
    const api = makeApi({ uploadRecording: vi.fn(async () => ({ ok: false, status: 500, data: null })) });
    render(
      <SayItem
        item={{ id: 's7', type: 'say', mode: 'say-after', wordId: 'gawi', word, assets: { audio: 'aud-gawi' } }}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={api}
        sittingId="sit1"
        userId="kid"
      />,
    );
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's7', status: 500 })));
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
    spy.mockRestore();
  });
});
