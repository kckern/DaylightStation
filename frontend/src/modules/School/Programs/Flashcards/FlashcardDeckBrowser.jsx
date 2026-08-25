import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import EmptyState, { LoadingState } from '../../home/EmptyState.jsx';

/** Standalone rich-deck shelf; course launch remains the preferred contextual path. */
export default function FlashcardDeckBrowser({ onLaunch }) {
  const [decks, setDecks] = useState(null); const [failed, setFailed] = useState(false);
  const launching = useRef(false);
  useEffect(() => {
    let alive = true;
    schoolApi.flashcardDecks().then(({ ok, data }) => {
      if (!alive) return;
      setFailed(!ok); setDecks(ok && Array.isArray(data?.decks) ? data.decks : []);
    });
    return () => { alive = false; };
  }, []);
  const launch = async (deck) => {
    if (launching.current) return;
    launching.current = true;
    try { await onLaunch(deck); } finally { launching.current = false; }
  };
  if (decks === null) return <LoadingState label="Loading flashcards…" />;
  if (failed) return <EmptyState icon="kind-deck" title="The flashcard shelf wouldn’t load." hint="Tell a grown-up, or try again in a bit." />;
  if (!decks.length) return <EmptyState icon="kind-deck" title="No rich flashcard decks yet." hint="Course decks appear here once a grown-up publishes them." />;
  return <section className="school-browse" aria-label="Flashcard decks"><h2>Flashcard decks</h2><div className="school-browse__grid">{decks.map((deck) => <article className="school-browse__card" key={deck.id}><h3 className="school-browse__title">{deck.title}</h3><p className="school-browse__meta">{deck.cardCount} cards</p>{deck.description && <p>{deck.description}</p>}<div className="school-browse__actions"><button type="button" onClick={() => launch(deck)}>Study</button></div></article>)}</div></section>;
}
