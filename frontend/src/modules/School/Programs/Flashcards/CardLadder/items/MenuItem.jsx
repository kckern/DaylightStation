import { useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import { cardLadderLog } from '../cardLadderLog.js';
import WordsItem from './WordsItem.jsx';

const LABELS = {
  flashcards: 'Flashcards', match: 'Match', say: 'Say', write: 'Write', listen: 'Listen', drill: 'Drill', quiz: 'Quiz me',
};
const HELP_MODES = new Set(['say', 'write']);

/**
 * The practice menu (spec §6), after the day's goal or cap. Offers exactly the
 * modes the server listed (`item.modes` — a mode with nothing in it is not
 * sent), plus My words and Done. Say / Write ask With help / Without help —
 * Say offers only the variants the server says have a run (`item.sayHelp`:
 * With help needs term audio, Without help does not); Write shows Without
 * help locked until a word is ready for its sign-off (`item.writeHelp`);
 * Flashcards asks which side faces up; Drill picks its words first. A choice
 * calls `api.practice` and hands the whole `{ok, status, data}` to
 * `onPractice` — the program shows the run's first item or recovers.
 */
export default function MenuItem({ item, api, sittingId, userId, deckId, langs, onPractice, onExit }) {
  const [view, setView] = useState({ name: 'menu' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const modes = (item.modes ?? []).filter((mode) => LABELS[mode]);
  // Which help variants to offer for a mode. Older servers send no sayHelp: both.
  const helpOptions = (mode) => (mode === 'say' && Array.isArray(item.sayHelp) ? item.sayHelp : [true, false]);
  // Write Without help types from memory, so it is shown LOCKED (with a note)
  // until a word is ready for its sign-off (`item.writeHelp` lacks `false`).
  const locked = (mode, help) => mode === 'write' && help === false && Array.isArray(item.writeHelp) && !item.writeHelp.includes(false);

  const start = async (opts) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const body = { userId, filter: 'introduced', ...opts };
    // `itemMode`, not `mode` — the trace stamp overwrites a colliding `mode` key.
    cardLadderLog.practiceStarted({ itemMode: body.mode, help: body.help ?? null, filter: body.filter, frontSide: body.frontSide ?? null, chosen: body.chosen?.length ?? null });
    const out = await api.practice(sittingId, body);
    setBusy(false);
    // A 404 reopens the sitting (the program does that); anything else leaves
    // the child on the menu, so say so rather than doing nothing.
    if (!out?.ok && out?.status !== 404) {
      setNotice("Couldn't start — try again");
      cardLadderLog.noticeShown({ itemMode: body.mode, reason: 'practice-start-failed', status: out?.status ?? null });
      if (view.name !== 'menu') setView({ name: 'menu' });
    }
    onPractice(out);
  };
  const choose = (mode) => {
    if (HELP_MODES.has(mode)) setView({ name: 'help', mode });
    else if (mode === 'flashcards') setView({ name: 'front' });
    else if (mode === 'drill') setView({ name: 'pick' });
    else start({ mode });
  };
  const back = () => setView({ name: 'menu' });

  // Every action has a key: modes by digit, My words the next digit, Done on
  // Space/Enter (the forward action), Back on Backspace.
  const wordsKey = String(modes.length + 1);
  const toWords = () => { if (!busy) setView({ name: 'words' }); };
  let keys = {};
  if (view.name === 'menu') keys = { ...Object.fromEntries(modes.map((mode, i) => [String(i + 1), () => choose(mode)])), [wordsKey]: toWords, ' ': onExit, enter: onExit };
  else if (view.name === 'help') keys = { ...Object.fromEntries(helpOptions(view.mode).flatMap((help, i) => (locked(view.mode, help) ? [] : [[String(i + 1), () => start({ mode: view.mode, help })]]))), backspace: back };
  else if (view.name === 'front') keys = { 1: () => start({ mode: 'flashcards', frontSide: 'term' }), 2: () => start({ mode: 'flashcards', frontSide: 'gloss' }), backspace: back };
  useCardLadderKeys(keys, { enabled: view.name === 'menu' || view.name === 'help' || view.name === 'front' });

  if (view.name === 'words' || view.name === 'pick') {
    return (
      <WordsItem
        api={api} sittingId={sittingId} userId={userId} deckId={deckId} langs={langs}
        pick={view.name === 'pick'} busy={busy} onBack={back}
        onDrill={(chosen) => start({ mode: 'drill', filter: 'chosen', chosen })}
      />
    );
  }
  if (view.name === 'help' || view.name === 'front') {
    const help = view.name === 'help';
    return (
      <section className="wl-item wl-menu" aria-label="Practice">
        <h2 className="wl-menu__title">{help ? LABELS[view.mode] : 'Flashcards — which side first?'}</h2>
        <div className="wl-menu__grid wl-menu__grid--two">
          {help ? (
            helpOptions(view.mode).map((help, i) => (locked(view.mode, help) ? (
              <div key={String(help)} className="wl-menu__locked">
                <TouchButton variant="choice" disabled aria-describedby="wl-menu-locked-note">Without help</TouchButton>
                <p id="wl-menu-locked-note" className="wl-menu__note">Unlocks when a word is ready</p>
              </div>
            ) : (
              <TouchButton key={String(help)} variant="choice" keyHint={String(i + 1)} disabled={busy} onClick={() => start({ mode: view.mode, help })}>
                {help ? 'With help' : 'Without help'}
              </TouchButton>
            )))
          ) : (
            <>
              <TouchButton variant="choice" keyHint="1" disabled={busy} onClick={() => start({ mode: 'flashcards', frontSide: 'term' })}>Word first</TouchButton>
              <TouchButton variant="choice" keyHint="2" disabled={busy} onClick={() => start({ mode: 'flashcards', frontSide: 'gloss' })}>Meaning first</TouchButton>
            </>
          )}
        </div>
        <div className="wl-controls"><TouchButton variant="secondary" keyHint="⌫" onClick={back}>Back</TouchButton></div>
      </section>
    );
  }
  return (
    <section className="wl-item wl-menu" aria-label="Practice">
      <h2 className="wl-menu__title">Practice</h2>
      <div className="wl-menu__grid">
        {modes.map((mode, i) => (
          <TouchButton key={mode} variant="choice" keyHint={String(i + 1)} disabled={busy} onClick={() => choose(mode)}>{LABELS[mode]}</TouchButton>
        ))}
        <TouchButton variant="secondary" keyHint={wordsKey} disabled={busy} onClick={toWords}>My words</TouchButton>
      </div>
      {notice && <p className="wl-say__notice" role="alert">{notice}</p>}
      <div className="wl-controls">
        <TouchButton variant="primary" keyHint="Space" onClick={onExit}>Done</TouchButton>
      </div>
    </section>
  );
}
