import { useEffect, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('add-combobox');

export function AddCombobox({ bucketId, onDone, onCancel, onSavedMeals }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const ridRef = useRef(0); // guards against a slow older suggest response overwriting a newer one

  useEffect(() => {
    if (!text.trim()) { setItems([]); return undefined; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const rid = ++ridRef.current;
      try {
        const res = await DaylightAPI(`api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(text.trim())}`);
        if (ridRef.current !== rid) return; // a newer keystroke's request already landed
        setItems(res?.items || []);
        setHighlight(-1);
      } catch (err) {
        if (ridRef.current !== rid) return;
        logger.warn('suggest.failed', { error: err?.message });
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [text]);

  const pick = async (entry) => {
    setPhase('parsing'); setError(null);
    try {
      const row = await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', { catalogEntryId: entry.id }, 'POST');
      // The real endpoint responds { logged: true, item: { uuid, ... } } — uuid is
      // never top-level. Tolerate both shapes defensively.
      const uuid = row?.item?.uuid ?? row?.uuid;
      if (uuid && bucketId) {
        await DaylightAPI(`api/v1/health/nutrilist/${uuid}`, { mealTime: bucketId }, 'PUT');
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
      // POST /nutrition/input now commits immediately ({ committed: true, ... }) —
      // no review phase. The rows are already logged (unsettled); the day
      // reload picks them up and shows the unsettled cue in place.
      await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: text.trim() }, 'POST');
      logger.info('sentence.committed', {});
      onDone();
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
      {onSavedMeals ? (
        <UnstyledButton className="health-suggest__saved-meals" onClick={onSavedMeals}>
          Saved meals ▸
        </UnstyledButton>
      ) : null}
    </div>
  );
}
export default AddCombobox;
