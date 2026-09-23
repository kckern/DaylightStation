import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MatchItem from './MatchItem.jsx';
import TilesItem from './TilesItem.jsx';
import DrillOfferItem from './DrillOfferItem.jsx';
import MenuItem from './MenuItem.jsx';
import DrillItem from './DrillItem.jsx';
import ListenItem from './ListenItem.jsx';
import WordsItem from './WordsItem.jsx';
import FlashcardItem from './FlashcardItem.jsx';
import SummaryItem from './SummaryItem.jsx';
import { wordLadderLog } from '../wordLadderLog.js';
import { startClip } from '../wordLadderAudio.js';

const audio = vi.hoisted(() => ({ stop: null }));
vi.mock('../wordLadderAudio.js', () => {
  audio.stop = vi.fn();
  return {
    playClip: vi.fn(async () => true),
    playSequence: vi.fn(async () => {}),
    // A clip that never ends on its own: only stop() (or unmount) ends a Listen run early.
    startClip: vi.fn(() => ({ done: new Promise(() => {}), stop: audio.stop })),
  };
});
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), phase: 'idle', verdict: null, stream: null, onLevel: vi.fn() })),
}));

const langs = { term: 'ko', gloss: 'en' };
const id = (x) => x;

// Real shape: WordLadderSittingService#publicItem → board(b) — pairs pre-joined.
const board = {
  pairs: [
    { wordId: 'gawi', term: '가위', right: { type: 'text', text: 'Scissors' } },
    { wordId: 'chaek', term: '책', right: { type: 'text', text: 'Book' } },
    { wordId: 'pul', term: '풀', right: { type: 'text', text: 'Glue' } },
    { wordId: 'pen', term: '펜', right: { type: 'text', text: 'Pen' } },
  ],
};
const matchItem = { id: 'p1:0', type: 'match', source: 'practice', board };

const rightColumn = () => within(screen.getByRole('group', { name: 'Meanings' })).getAllByRole('button').map((b) => b.querySelector('.ds-touch__label').textContent);

describe('MatchItem', () => {
  it('shuffles the right column independently of the pair order', () => {
    render(<MatchItem item={matchItem} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const pairOrder = board.pairs.map((p) => p.right.text);
    expect([...rightColumn()].sort()).toEqual([...pairOrder].sort());
    expect(rightColumn()).not.toEqual(pairOrder);
  });

  it('the shuffle is stable across re-renders of the same item', () => {
    const { rerender } = render(<MatchItem item={matchItem} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const first = rightColumn();
    rerender(<MatchItem item={{ ...matchItem }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} busy />);
    expect(rightColumn()).toEqual(first);
  });

  it('a wrong pair does not lock; all pairs matched → Next sends only {done:true} and logs match.completed', () => {
    const onRespond = vi.fn();
    const spy = vi.spyOn(wordLadderLog, 'matchCompleted');
    render(<MatchItem item={matchItem} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    const left = screen.getByRole('group', { name: 'Words' });
    const right = screen.getByRole('group', { name: 'Meanings' });
    // One miss first.
    fireEvent.click(within(left).getByText('가위'));
    fireEvent.click(within(right).getByText('Book'));
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    for (const pair of board.pairs) {
      fireEvent.click(within(left).getByText(pair.term));
      fireEvent.click(within(right).getByText(pair.right.text));
    }
    expect(onRespond).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ misses: 1, pairs: 4 }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('keyboard only: a digit picks a word, the next digit picks its meaning — a 4-pair board completes', () => {
    const onRespond = vi.fn();
    render(<MatchItem item={matchItem} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    const hints = (name) => within(screen.getByRole('group', { name })).getAllByRole('button')
      .map((b) => b.querySelector('.ds-touch__key')?.textContent);
    expect(hints('Words')).toEqual(['1', '2', '3', '4']);
    expect(hints('Meanings')).toEqual(['1', '2', '3', '4']);
    const meanings = rightColumn();
    board.pairs.forEach((pair, i) => {
      fireEvent.keyDown(window, { key: String(i + 1), code: `Digit${i + 1}` });
      expect(within(screen.getByRole('group', { name: 'Words' })).getAllByRole('button')[i]).toHaveAttribute('aria-pressed', 'true');
      const row = meanings.indexOf(pair.right.text) + 1;
      fireEvent.keyDown(window, { key: String(row), code: `Digit${row}` });
    });
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('an image right side renders the picture with its gloss as the fallback text', () => {
    const pics = { ...matchItem, board: { pairs: board.pairs.map((p) => ({ ...p, right: { type: 'image', image: `img-${p.wordId}`, text: p.right.text } })) } };
    render(<MatchItem item={pics} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Meanings' })).getAllByRole('img')).toHaveLength(4);
  });
});

// Real shape: drill tiles step → cued(): cue + assets + tiles; NO word/term.
const tilesItem = {
  id: 'd1:6', type: 'drill', step: 'tiles', wordId: 'gawi', of: 9, at: 7,
  tiles: ['위', '책', '가', '풀'], cue: { type: 'text', text: 'Scissors' }, assets: { image: null, audio: null, glossAudio: null },
};

describe('TilesItem', () => {
  it('sends the tapped order as {tiles}', () => {
    const onRespond = vi.fn();
    render(<TilesItem item={tilesItem} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    const pool = screen.getByRole('group', { name: 'Tiles' });
    fireEvent.click(within(pool).getByText('가'));
    fireEvent.click(within(pool).getByText('위'));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onRespond).toHaveBeenCalledWith({ tiles: ['가', '위'] });
  });

  it('digit keys tap tiles; tapping an answer tile removes it', () => {
    const onRespond = vi.fn();
    render(<TilesItem item={tilesItem} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: '4' }); // 풀
    fireEvent.keyDown(window, { key: '3' }); // 가
    fireEvent.click(within(screen.getByRole('group', { name: 'Your answer' })).getByText('풀'));
    fireEvent.keyDown(window, { key: '1' }); // 위
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledWith({ tiles: ['가', '위'] });
  });

  it('a miss says Not quite; the answer shows only when the result carries it', () => {
    const { rerender } = render(<TilesItem item={tilesItem} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: false, answer: null }} />);
    expect(screen.getByText(/Not quite/)).toBeInTheDocument();
    expect(screen.queryByText('가위')).toBeNull();
    rerender(<TilesItem item={tilesItem} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: false, answer: '가위' }} />);
    expect(screen.getByText('가위')).toBeInTheDocument();
  });
});

const offer = {
  id: 'r1:offer', type: 'drill-offer', wordId: 'gawi',
  word: { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: null, audio: 'aud', glossAudio: null } },
};

describe('DrillOfferItem', () => {
  it('1 = Practise → {drill:"yes"}; logs drill.offered', () => {
    const onRespond = vi.fn();
    const spy = vi.spyOn(wordLadderLog, 'drillOffered');
    render(<DrillOfferItem item={offer} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.getByText('가위')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1' });
    expect(onRespond).toHaveBeenCalledWith({ drill: 'yes' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }));
  });

  it('2 = Not now → {drill:"no"}', () => {
    const onRespond = vi.fn();
    render(<DrillOfferItem item={offer} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: '2' });
    expect(onRespond).toHaveBeenCalledWith({ drill: 'no' });
  });
});

function menuApi() {
  return {
    practice: vi.fn(async () => ({ ok: true, status: 200, data: { item: matchItem, progress: null } })),
    words: vi.fn(async () => ({
      ok: true, status: 200, data: {
        words: [
          { wordId: 'gawi', term: '가위', gloss: 'Scissors', state: 'familiar', stage: 0, tricky: true, dueDay: null },
          { wordId: 'chaek', term: '책', gloss: 'Book', state: 'mastered', stage: 1, tricky: false, dueDay: '2026-09-30' },
          { wordId: 'pul', term: '풀', gloss: 'Glue', state: 'new', stage: 0, tricky: false, dueDay: null },
        ],
      },
    })),
  };
}
const menuProps = (api, extra = {}) => ({
  item: { id: 'menu', type: 'menu', modes: ['match', 'say', 'flashcards', 'drill'], quizzed: 4 },
  api, sittingId: 's', userId: 'kid', deckId: 'd', langs, onPractice: vi.fn(), onExit: vi.fn(), ...extra,
});

describe('MenuItem', () => {
  it('offers only item.modes (plus My words and Done)', () => {
    render(<MenuItem {...menuProps(menuApi())} />);
    expect(screen.getByRole('button', { name: /match/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^say/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /flashcards/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /listen/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /quiz me/i })).toBeNull();
    expect(screen.getByRole('button', { name: /my words/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  it('Match calls api.practice and hands the result on; logs practice.started', async () => {
    const api = menuApi();
    const props = menuProps(api);
    const spy = vi.spyOn(wordLadderLog, 'practiceStarted');
    render(<MenuItem {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /match/i }));
    await waitFor(() => expect(props.onPractice).toHaveBeenCalled());
    expect(api.practice).toHaveBeenCalledWith('s', expect.objectContaining({ userId: 'kid', mode: 'match' }));
    expect(props.onPractice.mock.calls[0][0]).toEqual(expect.objectContaining({ ok: true }));
    // itemMode, not mode — createTrace's own live/test mode stamp would
    // otherwise clobber a colliding `mode` key in the logged payload.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ itemMode: 'match' }));
  });

  it('Say asks With help / Without help first', async () => {
    const api = menuApi();
    render(<MenuItem {...menuProps(api)} />);
    fireEvent.click(screen.getByRole('button', { name: /^say/i }));
    expect(api.practice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /without help/i }));
    await waitFor(() => expect(api.practice).toHaveBeenCalledWith('s', expect.objectContaining({ mode: 'say', help: false })));
  });

  it('Say offers only the help variants the server lists (no term audio → Without help only)', async () => {
    const api = menuApi();
    render(<MenuItem {...menuProps(api, { item: { id: 'menu', type: 'menu', modes: ['say'], sayHelp: [false], quizzed: 0 } })} />);
    fireEvent.click(screen.getByRole('button', { name: /^say/i }));
    expect(screen.queryByRole('button', { name: /^with help/i })).toBeNull();
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' });
    await waitFor(() => expect(api.practice).toHaveBeenCalledWith('s', expect.objectContaining({ mode: 'say', help: false })));
  });

  it('Flashcards asks for the front side', async () => {
    const api = menuApi();
    render(<MenuItem {...menuProps(api)} />);
    fireEvent.click(screen.getByRole('button', { name: /flashcards/i }));
    fireEvent.click(screen.getByRole('button', { name: /meaning/i }));
    await waitFor(() => expect(api.practice).toHaveBeenCalledWith('s', expect.objectContaining({ mode: 'flashcards', frontSide: 'gloss' })));
  });

  it('Drill picks words, then sends filter chosen with the picked ids', async () => {
    const api = menuApi();
    render(<MenuItem {...menuProps(api)} />);
    fireEvent.click(screen.getByRole('button', { name: /drill/i }));
    fireEvent.click(await screen.findByRole('button', { name: /가위/ }));
    fireEvent.click(screen.getByRole('button', { name: /drill these/i }));
    await waitFor(() => expect(api.practice).toHaveBeenCalledWith('s', expect.objectContaining({ mode: 'drill', filter: 'chosen', chosen: ['gawi'] })));
  });

  it('Done exits', () => {
    const props = menuProps(menuApi());
    render(<MenuItem {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(props.onExit).toHaveBeenCalled();
  });
});

describe('WordsItem', () => {
  it('lists words with state chips (read-only) and asks with the sitting id', async () => {
    const api = menuApi();
    render(<WordsItem api={api} sittingId="s" userId="kid" deckId="d" langs={langs} onBack={vi.fn()} />);
    expect(await screen.findByText('가위')).toBeInTheDocument();
    expect(api.words).toHaveBeenCalledWith({ userId: 'kid', deckId: 'd', sittingId: 's' });
    expect(screen.getByText('Familiar')).toBeInTheDocument();
    expect(screen.getByText('Tricky')).toBeInTheDocument();
    expect(screen.getByText(/Mastered/)).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /가위/ })).toBeNull();
  });
});

describe('WordsItem sign-off labels (ruling 2026-09-23)', () => {
  it('a mastered word reads Recognised until the typed sign-off, then Mastered', async () => {
    const api = {
      words: vi.fn(async () => ({
        ok: true, status: 200, data: {
          words: [
            { wordId: 'chaek', term: '책', gloss: 'Book', state: 'mastered', stage: 1, tricky: false, dueDay: null, level: 'recognised' },
            { wordId: 'mul', term: '물', gloss: 'Water', state: 'mastered', stage: 2, tricky: false, dueDay: null, level: 'mastered' },
          ],
        },
      })),
    };
    render(<WordsItem api={api} sittingId="s" userId="kid" deckId="d" langs={langs} onBack={vi.fn()} />);
    expect(await screen.findByText('책')).toBeInTheDocument();
    expect(screen.getByText('책').closest('li, tr, div').textContent).toMatch(/Recognised/);
    expect(screen.getByText('물').closest('li, tr, div').textContent).toMatch(/Mastered/);
    expect(screen.getAllByText(/Mastered/)).toHaveLength(1);
  });
});

describe('WordsItem failure', () => {
  it('a failed read logs words.failed, not write.failed', async () => {
    const spy = vi.spyOn(wordLadderLog, 'wordsFailed');
    const write = vi.spyOn(wordLadderLog, 'writeFailed');
    const api = { words: vi.fn(async () => ({ ok: false, status: 500, data: null })) };
    render(<WordsItem api={api} sittingId="s" userId="kid" deckId="d" langs={langs} onBack={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    expect(write).not.toHaveBeenCalled();
  });
});

describe('MenuItem failure', () => {
  it("a failed start (network / non-404) says Couldn't start on the menu", async () => {
    const api = menuApi();
    api.practice.mockResolvedValue({ ok: false, status: 0, data: null });
    const props = menuProps(api);
    render(<MenuItem {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /match/i }));
    expect(await screen.findByText(/Couldn.t start — try again/)).toBeInTheDocument();
    expect(props.onPractice).toHaveBeenCalled();
  });
});

describe('DrillItem', () => {
  it('a hidden step says "Practising a word", never "tricky"', () => {
    render(<DrillItem item={{ id: 'd1:5', type: 'drill', step: 'dictation', wordId: 'gawi', of: 9, at: 6, assets: { image: null, audio: 'aud', glossAudio: null } }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(screen.getByText(/Practising a word/)).toBeInTheDocument();
    expect(screen.queryByText(/tricky/)).toBeNull();
  });

  it('an unknown step offers Skip → {done:true}', () => {
    const onRespond = vi.fn();
    render(<DrillItem item={{ id: 'd1:9', type: 'drill', step: 'future-step', wordId: 'gawi', of: 9, at: 9 }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  const dictation = { id: 'd1:5', type: 'drill', step: 'dictation', wordId: 'gawi', of: 9, at: 6, assets: { image: null, audio: 'aud', glossAudio: null } };

  it('hides the term on dictation and shows step progress', () => {
    render(<DrillItem item={dictation} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(screen.queryByText('가위')).toBeNull();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
    expect(screen.getByText(/Step 6 of 9/)).toBeInTheDocument();
  });

  it('a dictation miss without an answer keeps the term hidden; with one, shows it to copy and keeps the field + Enter', () => {
    const { rerender } = render(<DrillItem item={dictation} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: false }} />);
    expect(screen.getByText(/Not quite/)).toBeInTheDocument();
    expect(screen.queryByText('가위')).toBeNull();
    rerender(<DrillItem item={dictation} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: false, answer: '가위' }} />);
    expect(screen.getByRole('status')).toHaveTextContent("It's 가위 — type it");
    expect(screen.getByLabelText('Your answer')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /enter/i })).toBeInTheDocument();
  });

  it('a held dictation result (third miss, step advanced) shows "It\'s X" and Next, not a retry', () => {
    const onContinue = vi.fn();
    render(<DrillItem item={dictation} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: false, answer: '가위' }} pending onContinue={onContinue} />);
    expect(screen.getByRole('status')).toHaveTextContent("It's 가위");
    expect(screen.getByRole('status')).not.toHaveTextContent('type it');
    expect(screen.getByLabelText('Your answer')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it('progress dots: steps before the current one are done, the current one is not', () => {
    const { container } = render(<DrillItem item={{ ...dictation, of: 5, at: 3 }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const dots = [...container.querySelectorAll('.wl-drill__dot')];
    expect(dots.map((d) => d.classList.contains('is-done'))).toEqual([true, true, false, false, false]);
    expect(dots[2].classList.contains('is-current')).toBe(true);
  });

  it('dictation sends only {typed}', () => {
    const onRespond = vi.fn();
    render(<DrillItem item={dictation} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    const input = screen.getByLabelText('Your answer');
    fireEvent.change(input, { target: { value: '가위' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledWith({ typed: '가위' });
  });

  it('look shows term, picture and gloss together; Next sends {done:true}', () => {
    const onRespond = vi.fn();
    const look = { id: 'd1:0', type: 'drill', step: 'look', wordId: 'gawi', of: 9, at: 1, word: { ...offer.word, media: { image: 'img', audio: 'aud', glossAudio: null } } };
    render(<DrillItem item={look} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.getAllByText('가위').length).toBeGreaterThan(0);
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('tiles never shows the term before the answer', () => {
    render(<DrillItem item={tilesItem} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    expect(screen.queryByText('가위')).toBeNull();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
  });
});

describe('ListenItem', () => {
  it('A does not restart a run that is still playing; Next stops the clip', () => {
    startClip.mockClear(); audio.stop.mockClear();
    const onRespond = vi.fn();
    render(<ListenItem item={{ id: 'p1:9', type: 'listen', source: 'practice', words: [{ wordId: 'gawi', term: '가위', audio: 'a1' }, { wordId: 'b', term: '책', audio: 'a2' }] }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(startClip).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'a' });
    expect(startClip).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: ' ' });
    expect(audio.stop).toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('unmounting stops the clip', () => {
    audio.stop.mockClear();
    const { unmount } = render(<ListenItem item={{ id: 'p1:8', type: 'listen', source: 'practice', words: [{ wordId: 'gawi', term: '가위', audio: 'a1' }] }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    unmount();
    expect(audio.stop).toHaveBeenCalled();
  });

  it('shows the words and Next sends {done:true}', async () => {
    const onRespond = vi.fn();
    render(<ListenItem item={{ id: 'p1:0', type: 'listen', source: 'practice', words: [{ wordId: 'gawi', term: '가위', audio: 'a1' }] }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.getByText('가위')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });
});

describe('FlashcardItem practice', () => {
  const word = offer.word;
  it('front gloss shows the meaning first and hides the Korean until flipped; Space then sends {next:true}', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'p1:0', type: 'flashcard', mode: 'practice', source: 'practice', front: 'gloss', word }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(screen.queryByText('가위')).toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('가위')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onRespond).toHaveBeenCalledWith({ next: true });
  });

  it('flipped practice card sorts with 1/2/3', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'p1:1', type: 'flashcard', mode: 'practice', source: 'practice', front: 'term', word }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '2' });
    expect(onRespond).toHaveBeenCalledWith({ sort: 'familiar' });
  });
});

describe('SummaryItem', () => {
  it('Practise more sends {done:true}; Done exits', () => {
    const onRespond = vi.fn();
    const onExit = vi.fn();
    render(<SummaryItem item={{ id: 'summary', type: 'summary', quizzed: 3 }} onRespond={onRespond} onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /practise more/i }));
    expect(onRespond).toHaveBeenCalledWith({ done: true });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^done/i })); });
    expect(onExit).toHaveBeenCalled();
  });
});
