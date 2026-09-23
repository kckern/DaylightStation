import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SayItem from './SayItem.jsx';
import { playClip, playSequence } from '../cardLadderAudio.js';
import { cardLadderLog } from '../cardLadderLog.js';

vi.mock('../cardLadderAudio.js', () => {
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
const recorderState = vi.hoisted(() => ({ phase: 'idle', verdict: null, unavailable: false }));
const recorderCalls = vi.hoisted(() => ({ start: null, stop: null }));
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn((opts) => {
    captured.onTake = opts.onTake;
    return {
      start: recorderCalls.start,
      stop: recorderCalls.stop,
      phase: recorderState.phase,
      verdict: recorderState.verdict,
      unavailable: recorderState.unavailable,
      stream: null,
      onLevel: vi.fn(),
    };
  }),
}));

const langs = { target: 'ko', anchor: 'en', targetScript: 'hangul' };

// Fixtures below are the ACTUAL server shapes from
// `CardLadderSittingService#publicItem` (backend/src/3_applications/school/
// CardLadderSittingService.mjs) — not a client guess. say-after alone gets a
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
  recorderState.unavailable = false;
  recorderCalls.start = vi.fn(async () => {});
  recorderCalls.stop = vi.fn(() => {});
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

  it('Backslash skips with no take made — the only key that does', () => {
    const onRespond = vi.fn();
    renderSay({ onRespond });
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash' });
    expect(onRespond).toHaveBeenCalledWith({ done: true });
    expect(hintOf(/skip/i)).toBe('\\');
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
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term', { trigger: 'auto' });
  });

  it('after a take, plays the take then the already-known native audio, even if the upload fails', async () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'aud-gawi', kind: 'term' }], { trigger: 'auto' });
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'aud-gawi', kind: 'term' }], { trigger: 'auto' });
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }], { trigger: 'auto' });
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }, { url: 'resolved:aud-gawi', kind: 'term' }], { trigger: 'auto' });
  });

  it('an upload failure never reveals the term — it has no other source', async () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
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
    expect(playSequence).toHaveBeenCalledWith([{ url: 'blob:take', kind: 'take' }], { trigger: 'auto' });
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

  it('logs say.recording uploaded on a successful upload', async () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
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
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's3', phase: 'uploaded', bytes: 1, durationMs: 2000, ms: expect.any(Number) }));
    spy.mockRestore();
  });
});

describe('SayItem — spec §8 recording and skip events', () => {
  const props = (over = {}) => ({
    item: sayAfterItem, mode: 'say-after', langs, resolveAssetUrl: (x) => x, onRespond: vi.fn(), api: makeApi(), sittingId: 'sit1', userId: 'kid', ...over,
  });

  it('logs started when the mic opens and stopped when the take ends', () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
    const { rerender } = render(<SayItem {...props()} />);
    recorderState.phase = 'recording';
    rerender(<SayItem {...props()} />);
    recorderState.phase = 'saving';
    rerender(<SayItem {...props()} />);
    expect(spy.mock.calls.map(([d]) => d.phase)).toEqual(['started', 'stopped']);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's3', itemMode: 'say-after', phase: 'started', ms: expect.any(Number) }));
    spy.mockRestore();
  });

  it('logs failed with the status when the upload is refused', async () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
    render(<SayItem {...props({ api: makeApi({ uploadRecording: vi.fn(async () => ({ ok: false, status: 500, data: null })) }) })} />);
    await act(async () => { await captured.onTake({ blob: new Blob(['x']), durationMs: 900 }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed', status: 500 }));
    spy.mockRestore();
  });

  it('logs refused with the reason, and unavailable when there is no mic', () => {
    const spy = vi.spyOn(cardLadderLog, 'sayRecording').mockImplementation(() => {});
    recorderState.verdict = 'too-quiet';
    const { unmount } = render(<SayItem {...props()} />);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ phase: 'refused', reason: 'too-quiet' }));
    unmount();
    recorderState.verdict = null;
    recorderState.unavailable = true;
    render(<SayItem {...props()} />);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ phase: 'unavailable' }));
    spy.mockRestore();
  });

  it('a Skip with no take logs item.skipped with how it was pressed; Next after a take does not', async () => {
    const spy = vi.spyOn(cardLadderLog, 'itemSkipped').mockImplementation(() => {});
    const { unmount } = render(<SayItem {...props()} />);
    act(() => { fireEvent.keyDown(window, { key: '\\', code: 'Backslash' }); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemId: 's3', type: 'say', what: 'say', via: 'key:Backslash', micOff: false, ms: expect.any(Number) }));
    unmount();
    spy.mockClear();
    render(<SayItem {...props()} />);
    await act(async () => { await captured.onTake({ blob: new Blob(['x']), durationMs: 900 }); });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(spy).not.toHaveBeenCalled();
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

function renderSay({ onRespond = vi.fn(), item = readAloudItem, mode = 'read-aloud' } = {}) {
  return render(
    <SayItem
      item={item}
      mode={mode}
      langs={langs}
      resolveAssetUrl={(x) => x}
      onRespond={onRespond}
      api={makeApi()}
      sittingId="sit1"
      userId="kid"
    />,
  );
}
const hintOf = (name) => screen.getByRole('button', { name }).querySelector('.ds-touch__key')?.textContent ?? null;
const space = () => fireEvent.keyDown(window, { key: ' ', code: 'Space' });
const takeArrives = async () => {
  const blob = new Blob(['x'], { type: 'audio/webm' });
  await act(async () => { await captured.onTake({ blob, durationMs: 2000 }); });
};

describe('SayItem — Space is the forward action, never a skip', () => {
  it('before a take, Space starts recording — and never calls skip or next', () => {
    const onRespond = vi.fn();
    renderSay({ onRespond });
    expect(hintOf(/^record/i)).toBe('Space');
    space();
    expect(recorderCalls.start).toHaveBeenCalledTimes(1);
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('while recording, Space stops the take', () => {
    recorderState.phase = 'recording';
    const onRespond = vi.fn();
    renderSay({ onRespond });
    expect(hintOf(/stop/i)).toBe('Space');
    space();
    expect(recorderCalls.stop).toHaveBeenCalledTimes(1);
    expect(recorderCalls.start).not.toHaveBeenCalled();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('after a take, Space goes Next; Record again is touch-only (no Space hint)', async () => {
    const onRespond = vi.fn();
    renderSay({ onRespond });
    await takeArrives();
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument());
    expect(hintOf(/next/i)).toBe('Space');
    expect(hintOf(/record again/i)).not.toBe('Space');
    space();
    expect(onRespond).toHaveBeenCalledWith({ done: true });
    expect(recorderCalls.start).not.toHaveBeenCalled();
  });

  it('Skip is visible and clickable from the first render, with no recording, and while recording', () => {
    const onRespond = vi.fn();
    const { unmount } = renderSay({ onRespond });
    const skip = screen.getByRole('button', { name: /skip/i });
    expect(skip).not.toBeDisabled();
    fireEvent.click(skip);
    expect(onRespond).toHaveBeenCalledWith({ done: true });
    unmount();
    recorderState.phase = 'recording';
    renderSay();
    expect(screen.getByRole('button', { name: /skip/i })).not.toBeDisabled();
  });

  it('with the mic refused/unavailable, Space advances instead of a dead Record', () => {
    recorderState.unavailable = true;
    const onRespond = vi.fn();
    renderSay({ onRespond });
    expect(hintOf(/next/i)).toBe('Space');
    space();
    expect(recorderCalls.start).not.toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith({ done: true }, { micOff: true });
  });

  it('say-from-cue audio cue: Tab replays the cue, and its Listen hints Tab', () => {
    const item = { ...sayFromCueItem, id: 's6', cue: { type: 'audio' }, assets: { image: null, audio: null, glossAudio: 'g-aud' } };
    renderSay({ item, mode: 'say-from-cue' });
    playClip.mockClear();
    expect(fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' })).toBe(false);
    expect(playClip).toHaveBeenCalledWith('g-aud', 'gloss');
    expect(hintOf(/listen/i)).toBe('Tab');
  });
});

describe('SayItem — ArrowLeft = Record again', () => {
  it('after a take, ArrowLeft starts a fresh recording; its button hints ←', async () => {
    const onRespond = vi.fn();
    renderSay({ onRespond });
    await takeArrives();
    await waitFor(() => expect(screen.getByRole('button', { name: /record again/i })).toBeInTheDocument());
    expect(hintOf(/record again/i)).toBe('←');
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(recorderCalls.start).toHaveBeenCalledTimes(1);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('before any take, ArrowLeft does nothing', () => {
    const onRespond = vi.fn();
    renderSay({ onRespond });
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(recorderCalls.start).not.toHaveBeenCalled();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('with the mic unavailable, ArrowLeft does nothing even after a take', async () => {
    recorderState.unavailable = true;
    renderSay();
    await takeArrives();
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(recorderCalls.start).not.toHaveBeenCalled();
  });
});

// Fable review (owner rulings 2026-09-23): Tab = hear it on every item with any
// audio; Space never skips — with no mic the forward button is Next, and it is
// an answer (item.answered, micOff), never a skip.
describe('SayItem — Tab hears the model; no Space-Skip', () => {
  const tab = () => fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });

  it('say-after: Tab replays the term audio (prevented), and a Hear it button hints Tab', () => {
    renderSay({ item: sayAfterItem, mode: 'say-after' });
    playClip.mockClear();
    expect(tab()).toBe(false);
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
    expect(hintOf(/hear it/i)).toBe('Tab');
    fireEvent.click(screen.getByRole('button', { name: /hear it/i }));
    expect(playClip).toHaveBeenCalledTimes(2);
  });

  it('read-aloud: nothing to hear before the take; after the reveal Tab plays the revealed audio', async () => {
    const api = makeApi({ uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { take: 1, reveal: { term: '가위', audio: 'rev-aud' } } })) });
    render(<SayItem item={readAloudItem} mode="read-aloud" langs={langs} resolveAssetUrl={(x) => x} onRespond={vi.fn()} api={api} sittingId="sit1" userId="kid" />);
    expect(screen.queryByRole('button', { name: /hear it/i })).toBeNull();
    await takeArrives();
    playClip.mockClear();
    expect(tab()).toBe(false);
    expect(playClip).toHaveBeenCalledWith('rev-aud', 'term');
    expect(hintOf(/hear it/i)).toBe('Tab');
  });

  it('Tab plays nothing while the mic is open', () => {
    recorderState.phase = 'recording';
    renderSay({ item: sayAfterItem, mode: 'say-after' });
    playClip.mockClear();
    tab();
    expect(playClip).not.toHaveBeenCalled();
  });

  it('mic off: the Space button reads Next, logs item.answered-with-micOff (never item.skipped), and carries no Backslash', () => {
    recorderState.unavailable = true;
    const skipped = vi.spyOn(cardLadderLog, 'itemSkipped').mockImplementation(() => {});
    const onRespond = vi.fn();
    renderSay({ onRespond });
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
    expect(hintOf(/next/i)).toBe('Space');
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash' });
    expect(onRespond).not.toHaveBeenCalled();
    space();
    expect(onRespond).toHaveBeenCalledWith({ done: true }, { micOff: true });
    expect(skipped).not.toHaveBeenCalled();
    skipped.mockRestore();
  });

  it('Backslash belongs to Skip only: a Next (recording again after a take) carries no key and Backslash does nothing', async () => {
    const onRespond = vi.fn();
    const props = { item: readAloudItem, mode: 'read-aloud', langs, resolveAssetUrl: (x) => x, onRespond, api: makeApi(), sittingId: 'sit1', userId: 'kid' };
    const { rerender } = render(<SayItem {...props} />);
    expect(hintOf(/skip/i)).toBe('\\');
    await takeArrives();
    recorderState.phase = 'recording';
    rerender(<SayItem {...props} />);
    expect(hintOf(/next/i)).toBeNull();
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash' });
    expect(onRespond).not.toHaveBeenCalled();
  });
});
