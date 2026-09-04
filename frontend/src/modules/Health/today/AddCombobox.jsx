import { useEffect, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { nutritionIconUrl } from './iconUrl.js';

const logger = createAppLogger('health').child('add-combobox');

// The zero-keystroke list is a SHORTLIST of this bucket's regulars, not a
// browse surface: it opens with no user intent behind it, and every row it
// draws fires an icon request. Eight fits a phone screen without scrolling and
// keeps that burst nowhere near the render-herd shape Phase 7 had to bound.
// The TYPED list keeps the server default — there the user is steering, and a
// filtered list is already short.
const OPEN_SUGGEST_LIMIT = 8;

export function AddCombobox({ bucketId, date = null, onDone, onCancel, onMeals, onTemplate }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing
  const [error, setError] = useState(null);
  const [failedIcons, setFailedIcons] = useState(() => new Set());
  const debounceRef = useRef(null);
  const ridRef = useRef(0); // guards against a slow older suggest response overwriting a newer one

  // One effect for both lists. With text, it is the query path exactly as
  // before (debounced). Without, it is the bucket-aware zero-keystroke list
  // (PRD F8.1) — fired immediately, because there is no keystroke to wait for
  // and a debounce here would just be latency between the tap and the
  // suggestions. Both share the `rid` guard, so a slow open cannot overwrite a
  // fast first keystroke, or vice versa.
  useEffect(() => {
    const q = text.trim();
    const path = q
      ? `api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(q)}`
      : `api/v1/health/nutrition/catalog/suggest?${bucketId ? `bucket=${encodeURIComponent(bucketId)}&` : ''}limit=${OPEN_SUGGEST_LIMIT}`;
    const fetchSuggestions = async () => {
      const rid = ++ridRef.current;
      try {
        const res = await DaylightAPI(path);
        if (ridRef.current !== rid) return; // a newer keystroke's request already landed
        const next = res?.items || [];
        setItems(next);
        setHighlight(-1);
        if (!q) logger.debug('suggest.opened', { bucket: bucketId ?? null, count: next.length });
      } catch (err) {
        if (ridRef.current !== rid) return;
        logger.warn('suggest.failed', { error: err?.message, typed: q.length > 0 });
      }
    };
    if (!q) { fetchSuggestions(); return undefined; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchSuggestions, 250);
    return () => clearTimeout(debounceRef.current);
  }, [text, bucketId]);

  const pick = async (entry) => {
    // A template is not a quick-add: it can carry variants, and PRD F6.1 says
    // instantiating OFFERS them. So the picker takes over from here rather
    // than this list silently logging one arrangement of the meal.
    if (entry?.type === 'template') {
      logger.info('template.picked', { id: entry.id, bucket: bucketId });
      onTemplate?.(entry);
      return;
    }
    setPhase('parsing'); setError(null);
    try {
      // One request, not two. `mealTime` travels WITH the quick-add (Task 9.1),
      // which retires the follow-up PUT this used to make. That PUT was doing
      // exactly two things beyond moving the row — stamping settled/settledBy
      // (the generic update path ratifies by default) and cascading a group's
      // mealTime to its children — and quickAdd now writes the stamp itself
      // (PRD F8.3), while a quick-added row is `kind: 'item'` with no children
      // and never had anything to cascade. Deleting it also closes a real hole:
      // when the PUT failed, the row was left in the CLOCK's bucket and
      // unsettled, with the combobox already closed.
      await DaylightAPI(
        'api/v1/health/nutrition/catalog/quickadd',
        // The row lands on the day being VIEWED, in the meal row it was
      // launched from. Both keys are omitted when absent — absent still means
      // "today" / "the clock's meal" on the server.
      { catalogEntryId: entry.id, ...(bucketId ? { mealTime: bucketId } : {}), ...(date ? { date } : {}) },
        'POST',
      );
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
      await DaylightAPI(
      'api/v1/health/nutrition/input',
      // The sentence is parsed against the VIEWED day ("this morning" means
      // that day's morning), and it lands in the meal row it was typed into —
      // the bucket was previously dropped here, so a sentence typed into
      // Breakfast was filed by the clock.
      { type: 'text', content: text.trim(), ...(bucketId ? { bucket: bucketId } : {}), ...(date ? { date } : {}) },
      'POST',
    );
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
        {items.map((entry, i) => {
          // The food's picture where it has one (PRD F5.3 asks for it here too).
          // A slug whose image fails is retired by NAME, so a later suggestion of
          // the same food does not re-request it — and the row simply loses the
          // icon rather than showing a broken image.
          const iconUrl = failedIcons.has(entry.icon) ? null : nutritionIconUrl(entry.icon);
          return (
            <li key={`${entry.type ?? 'food'}:${entry.id}`}>
              <UnstyledButton
                className={`health-suggest__item${entry.favorite ? ' health-suggest__item--fav' : ''}${i === highlight ? ' health-suggest__item--hi' : ''}`}
                role="option" aria-selected={i === highlight}
                onClick={() => pick(entry)}>
                {entry.favorite ? <span className="health-suggest__star" aria-label="favorite">★</span> : null}
                {iconUrl ? (
                  <img
                    className="health-suggest__icon"
                    src={iconUrl}
                    alt=""
                    loading="lazy"
                    onError={() => {
                      logger.debug('suggest.icon_failed', { icon: entry.icon });
                      setFailedIcons((prev) => new Set(prev).add(entry.icon));
                    }}
                  />
                ) : null}
                <span>{entry.name}</span>
                {entry.type === 'template' ? (
                  // A meal-level suggestion is visually distinguished from a
                  // single food (PRD F8.2) by a NON-COLOUR cue: the item count.
                  <span className="health-suggest__badge">{`${entry.itemCount ?? 0} items`}</span>
                ) : null}
                <span className="health-suggest__kcal">{entry.nutrients?.calories ?? ''}</span>
              </UnstyledButton>
            </li>
          );
        })}
      </ul>
      {onMeals ? (
        <UnstyledButton className="health-suggest__saved-meals" onClick={onMeals}>
          Meals &amp; templates ▸
        </UnstyledButton>
      ) : null}
    </div>
  );
}
export default AddCombobox;
