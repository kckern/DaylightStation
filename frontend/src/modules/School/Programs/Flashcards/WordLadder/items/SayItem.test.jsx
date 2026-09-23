import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SayItem from './SayItem.jsx';
import { playClip, playSequence } from '../wordLadderAudio.js';
import { wordLadderLog } from '../wordLadderLog.js';

vi.mock('../wordLadderAudio.js', () => {
  const clip = vi.fn(async () => true);
  const sequence = vi.fn(async (urls) => { for (const u of urls) await clip(u); });
  return { playClip: clip, playSequence: sequence };
});

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

const langs = { term: 'ko', gloss: 'en' };

// Fixtures below are the ACTUAL server shapes from
// `WordLadderSittingService#publicItem` (backend/src/3_applications/school/
// WordLadderSittingService.mjs) — not a client guess. say-after alone gets a
// full word card with real media ids; read-aloud gets a word but every media
// id is null; say-from-cue gets NO `word` key at all, only the cue.
const sayAfterItem = {
  id: 's3', type: 'say', mode: 'say-after', wordId: 'gawi',
  word: {
    wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: 'img-gawi', audio: 'aud-gawi', glossAudio: null },
  },
};
const readAloudItem = {
  id: 's4', type: 'say', mode: 'read-aloud', wordId: 'gawi',
  word: { wordId: 'gawi', term: '가위', kind: 'word', media: { image: null, audio: null, glossAudio: null } },
};
const sayFromCueItem = {
  id: 's5', type: 'say', mode: 'say-from-cue', wordId: 'gawi', cue: { type: 'text', text: 'Scissors' }, assets: { image: null, audio: null, glossAudio: null },
};

function makeApi(overrides = {}) {
  return { uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { take: 1 } })), ...overrides };
}

beforeEach(() => {
  recorderState.phase = 'idle';
  recorderState.verdict = null;
  captured.onTake = null;
  window.URL.createObjectURL = vi.fn(() => 'blob:take');
  window.URL.revokeObjectURL = vi.fn();
  playClip.mockClear();
  playSequence.mockClear();
});

describe('SayItem — Next is never a gate', () => {
  it('say-after: Skip is available and sends {done:true} before any take', () => {
    const onRespond = vi.fn();
    render(
      <SayItem
        item={sayAfterItem}
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
        item={readAloudItem}
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
        item={sayAfterItem}
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
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
  });

  it('after a take, plays the take then the already-known native audio, even if the upload fails', async () => {
    const spy = vi.spyOn(wordLadderLog, 'recordingFailed').mockImplementation(() => {});
    const api = makeApi({ uploadRecording: vi.fn(async () => ({ ok: false, status: 500, data: null })) });
    render(
      <SayItem
        item={sayAfterItem}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={api}
        sittingId="sit1"
        userId="kid"
      />,
    );
    playClip.mockClear();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'aud-gawi', kind: 'term' }]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's3', status: 500 }));
    spy.mockRestore();
  });
});

describe('SayItem — read-aloud', () => {
  it('shows the term but plays no audio on arrival (media is null until a take)', () => {
    render(
      <SayItem
        item={readAloudItem}
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

  it('a successful take reveals the native audio via the upload response, not a locally-known clip', async () => {
    const api = makeApi({
      uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { take: 1, reveal: { term: '가위', audio: 'aud-gawi' } } })),
    });
    render(
      <SayItem
        item={readAloudItem}
        mode="read-aloud"
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
    expect(api.uploadRecording).toHaveBeenCalledWith('sit1', { userId: 'kid', itemId: 's4', blob });
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'aud-gawi', kind: 'term' }]);
  });

  it('an upload failure plays only the take — no reveal, no native audio', async () => {
    const api = makeApi({ uploadRecording: vi.fn(async () => ({ ok: false, status: 500, data: null })) });
    render(
      <SayItem
        item={readAloudItem}
        mode="read-aloud"
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }]);
  });
});

describe('SayItem — say-from-cue', () => {
  it('renders no term before the take — only the cue', () => {
    render(
      <SayItem
        item={sayFromCueItem}
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

  it('reveals the term ONLY from the upload response, playing the take then resolveAssetUrl(reveal.audio)', async () => {
    const api = makeApi({
      uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { take: 1, reveal: { term: '가위', audio: 'aud-gawi' } } })),
    });
    const resolveAssetUrl = vi.fn((id) => `resolved:${id}`);
    render(
      <SayItem
        item={sayFromCueItem}
        mode="say-from-cue"
        langs={langs}
        resolveAssetUrl={resolveAssetUrl}
        onRespond={() => {}}
        api={api}
        sittingId="sit1"
        userId="kid"
      />,
    );
    expect(screen.queryByText('가위')).toBeNull();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(screen.getByText('가위')).toBeInTheDocument();
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'resolved:aud-gawi', kind: 'term' }]);
  });

  it('an upload failure never reveals the term — it has no other source', async () => {
    const spy = vi.spyOn(wordLadderLog, 'recordingFailed').mockImplementation(() => {});
    const api = makeApi({ uploadRecording: vi.fn(async () => ({ ok: false, status: 500, data: null })) });
    render(
      <SayItem
        item={sayFromCueItem}
        mode="say-from-cue"
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
    expect(screen.queryByText('가위')).toBeNull();
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }]);
    // The take still happened — Next replaces Skip even though nothing revealed.
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('SayItem — uploads and Next/Skip wording', () => {
  it('uploads the take via api.uploadRecording, and Next replaces Skip', async () => {
    const api = makeApi();
    const onRespond = vi.fn();
    render(
      <SayItem
        item={sayAfterItem}
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
    expect(api.uploadRecording).toHaveBeenCalledWith('sit1', { userId: 'kid', itemId: 's3', blob });
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('logs recording.uploaded on a successful upload', async () => {
    const spy = vi.spyOn(wordLadderLog, 'recordingUploaded').mockImplementation(() => {});
    render(
      <SayItem
        item={sayAfterItem}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's3' }));
    spy.mockRestore();
  });
});

describe('SayItem — take object URL lifecycle', () => {
  it('revokes the take URL on unmount, not only when a later take replaces it', async () => {
    const { unmount } = render(
      <SayItem
        item={sayAfterItem}
        mode="say-after"
        langs={langs}
        resolveAssetUrl={(x) => x}
        onRespond={() => {}}
        api={makeApi()}
        sittingId="sit1"
        userId="kid"
      />,
    );
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:take');
  });
});
