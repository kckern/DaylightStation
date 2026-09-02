import { useEffect, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { PendingConfirmCard } from './PendingConfirmCard.jsx';

const logger = createAppLogger('health').child('add-combobox');

export function AddCombobox({ bucketId, onDone, onCancel }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing | review
  const [pending, setPending] = useState(null); // { messages }
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!text.trim()) { setItems([]); return undefined; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await DaylightAPI(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(text.trim())}`);
        setItems(res?.items || []);
        setHighlight(-1);
      } catch (err) {
        logger.warn('suggest.failed', { error: err?.message });
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [text]);

  const pick = async (entry) => {
    setPhase('parsing'); setError(null);
    try {
      const row = await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', { catalogEntryId: entry.id }, 'POST');
      if (row?.uuid && bucketId) {
        await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { mealTime: bucketId }, 'PUT');
      }
      logger.info('quickadd.done', { entry: entry.name, bucket: bucketId });
      onDone();
    } catch (err) {
      logger.error('quickadd.failed', { error: err?.message });
      setError(err); setPhase('typing');
    }
  };

  const submitSentence = async () => {
    if (!text.trim()) return;
    setPhase('parsing'); setError(null);
    logger.info('sentence.submit', { length: text.length });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: text.trim() }, 'POST');
      setPending({ messages: result?.messages || [] });
      setPhase('review');
    } catch (err) {
      logger.error('sentence.failed', { error: err?.message });
      setError(err); setPhase('typing'); // text preserved — input never lost
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return onCancel();
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && items[highlight]) pick(items[highlight]);
      else submitSentence();
    }
  };

  if (phase === 'review' && pending) {
    return <PendingConfirmCard messages={pending.messages} onDone={onDone} onDiscard={onCancel} />;
  }

  return (
    <div className="health-suggest">
      <TextInput autoFocus size="sm" value={text} placeholder="Food name, or a sentence to parse…"
        onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
        rightSection={phase === 'parsing' ? <Loader size="xs" /> : null} />
      {error ? <p className="health-suggest__error">{error.message}</p> : null}
      <ul className="health-suggest__list" role="listbox">
        {items.map((entry, i) => (
          <li key={entry.id}>
            <UnstyledButton
              className={`health-suggest__item${entry.favorite ? ' health-suggest__item--fav' : ''}${i === highlight ? ' health-suggest__item--hi' : ''}`}
              role="option" aria-selected={i === highlight}
              onClick={() => pick(entry)}>
              {entry.favorite ? <span className="health-suggest__star" aria-label="favorite">★</span> : null}
              <span>{entry.name}</span>
              <span className="health-suggest__kcal">{entry.nutrients?.calories ?? ''}</span>
            </UnstyledButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
export default AddCombobox;
