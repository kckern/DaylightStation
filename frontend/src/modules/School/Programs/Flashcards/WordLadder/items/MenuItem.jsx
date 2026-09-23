import { useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';
import WordsItem from './WordsItem.jsx';

const LABELS = {
  flashcards: 'Flashcards', match: 'Match', say: 'Say', write: 'Write', listen: 'Listen', drill: 'Drill', quiz: 'Quiz me',
};
const HELP_MODES = new Set(['say', 'write']);

/**
 * The practice menu (spec §6), after the day's goal or cap. Offers exactly the
 * modes the server listed (`item.modes` — a mode with nothing in it is not
 * sent), plus My words and Done. Say / Write ask With help / Without help;
 * Flashcards asks which side faces up; Drill picks its words first. A choice
 * calls `api.practice` and hands the whole `{ok, status, data}` to
 * `onPractice` — the program shows the run's first item or recovers.
 */
export default function MenuItem({ item, api, sittingId, userId, deckId, langs, onPractice, onExit }) {
  const [view, setView] = useState({ name: 'menu' });
  const [busy, setBusy] = useState(false);
  const modes = (item.modes ?? []).filter((mode) => LABELS[mode]);

  const start = async (opts) => {
    if (busy) return;
    setBusy(true);
    const body = { userId, filter: 'introduced', ...opts };
    wordLadderLog.practiceStarted({ mode: body.mode, help: body.help ?? null, filter: body.filter, frontSide: body.frontSide ?? null, chosen: body.chosen?.length ?? null });
    const out = await api.practice(sittingId, body);
    setBusy(false);
    onPractice(out);
  };
  const choose = (mode) => {
    if (HELP_MODES.has(mode)) setView({ name: 'help', mode });
    else if (mode === 'flashcards') setView({ name: 'front' });
    else if (mode === 'drill') setView({ name: 'pick' });
    else start({ mode });
  };
  const back = () => setView({ name: 'menu' });

  let keys = {};
  if (view.name === 'menu') keys = Object.fromEntries(modes.map((mode, i) => [String(i + 1), () => choose(mode)]));
  else if (view.name === 'help') keys = { 1: () => start({ mode: view.mode, help: true }), 2: () => start({ mode: view.mode, help: false }) };
  else if (view.name === 'front') keys = { 1: () => start({ mode: 'flashcards', frontSide: 'term' }), 2: () => start({ mode: 'flashcards', frontSide: 'gloss' }) };
  useWordLadderKeys(keys, { enabled: view.name === 'menu' || view.name === 'help' || view.name === 'front' });

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
            <>
              <TouchButton variant="choice" keyHint="1" disabled={busy} onClick={() => start({ mode: view.mode, help: true })}>With help</TouchButton>
              <TouchButton variant="choice" keyHint="2" disabled={busy} onClick={() => start({ mode: view.mode, help: false })}>Without help</TouchButton>
            </>
          ) : (
            <>
              <TouchButton variant="choice" keyHint="1" disabled={busy} onClick={() => start({ mode: 'flashcards', frontSide: 'term' })}>Word first</TouchButton>
              <TouchButton variant="choice" keyHint="2" disabled={busy} onClick={() => start({ mode: 'flashcards', frontSide: 'gloss' })}>Meaning first</TouchButton>
            </>
          )}
        </div>
        <div className="wl-controls"><TouchButton variant="secondary" onClick={back}>Back</TouchButton></div>
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
        <TouchButton variant="secondary" disabled={busy} onClick={() => setView({ name: 'words' })}>My words</TouchButton>
      </div>
      <div className="wl-controls">
        <TouchButton variant="primary" onClick={onExit}>Done</TouchButton>
      </div>
    </section>
  );
}
