import { useEffect, useId, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader, Button } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { operationRequest } from '../capture/operationRequest.js';
import { FoodIcon } from './FoodIcon.jsx';

const logger = createAppLogger('health').child('add-combobox');

// The zero-keystroke list is a SHORTLIST of this bucket's regulars, not a
// browse surface: it opens with no user intent behind it, and every row it
// draws fires an icon request. Eight fits a phone screen without scrolling and
// keeps that burst nowhere near the render-herd shape Phase 7 had to bound.
// The TYPED list keeps the server default — there the user is steering, and a
// filtered list is already short.
const OPEN_SUGGEST_LIMIT = 8;

export function AddCombobox({ bucketId, date = null, onDone, onCancel, onMeals, onTemplate, onManageFoods,
  inline = false, label = null, focusRequest = 0, actions = null }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const ridRef = useRef(0); // guards against a slow older suggest response overwriting a newer one
  const submitting = useRef(false);
  const requestRef = useRef(null);
  const listId = useId();
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const surface = inline ? 'inline' : 'sheet';
  // Inline rows sit on every visible meal at once, so each one fetches and
  // draws its shortlist only while it is being used.
  const open = !inline || focused || text.trim().length > 0;
  useEffect(() => { if (focusRequest) inputRef.current?.focus(); }, [focusRequest]);

  // One effect for both lists. With text, it is the query path exactly as
  // before (debounced). Without, it is the bucket-aware zero-keystroke list
  // (PRD F8.1) — fired immediately, because there is no keystroke to wait for
  // and a debounce here would just be latency between the tap and the
  // suggestions. Both share the `rid` guard, so a slow open cannot overwrite a
  // fast first keystroke, or vice versa.
  useEffect(() => {
    if (!open) return undefined;
    const q = text.trim();
    const path = q
      ? `api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(q)}${bucketId ? `&bucket=${encodeURIComponent(bucketId)}` : ''}`
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
  }, [text, bucketId, open]);

  // The sheet unmounts on success. The inline row stays: clear it, forget
  // the operation id (the next add is a new intent even when the payload is
  // identical), and hand focus back for the next food.
  const finish = (result) => {
    if (inline) {
      requestRef.current = null;
      setText(''); setHighlight(-1); setPhase('typing');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    onDone?.(result);
  };

  const pick = async (entry) => {
    if (submitting.current) return;
    // A template is not a quick-add: it can carry variants, and PRD F6.1 says
    // instantiating OFFERS them. So the picker takes over from here rather
    // than this list silently logging one arrangement of the meal.
    if (entry?.type === 'template') {
      logger.info('template.picked', { id: entry.id, bucket: bucketId });
      onTemplate?.(entry);
      return;
    }
    submitting.current = true;
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
      operationRequest(requestRef, { catalogEntryId: entry.id, ...(bucketId ? { mealTime: bucketId } : {}), ...(date ? { date } : {}) }),
        'POST',
      );
      logger.info('quickadd.done', { entry: entry.name, bucket: bucketId, surface });
      finish();
    } catch (err) {
      logger.error('quickadd.failed', { error: err?.message });
      setError(err); setPhase('typing');
    } finally { submitting.current = false; }
  };

  const submitSentence = async () => {
    if (!text.trim() || submitting.current) return;
    submitting.current = true;
    setPhase('parsing'); setError(null);
    logger.info('sentence.submit', { length: text.length });
    try {
      // POST /nutrition/input now commits immediately ({ committed: true, ... }) —
      // no review phase. The rows are already logged (unsettled); the day
      // reload picks them up and shows the unsettled cue in place.
      const result = await DaylightAPI(
      'api/v1/health/nutrition/input',
      // The sentence is parsed against the VIEWED day ("this morning" means
      // that day's morning), and it lands in the meal row it was typed into —
      // the bucket was previously dropped here, so a sentence typed into
      // Breakfast was filed by the clock.
      operationRequest(requestRef, { type: 'text', content: text.trim(), ...(bucketId ? { bucket: bucketId } : {}), ...(date ? { date } : {}) }),
      'POST',
    );
      logger.info('sentence.committed', { bucket: bucketId, surface });
      if (result?.noFood || result?.committed === false) {
        setError(new Error(result?.message || 'No food was logged. Tweak the sentence and try again.'));
        setPhase('typing');
      } else finish(result);
    } catch (err) {
      logger.error('sentence.failed', { error: err?.message });
      setError(err); setPhase('typing'); // text preserved — input never lost
    } finally { submitting.current = false; }
  };

  const onKeyDown = (e) => {
    if (submitting.current) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (!inline) return onCancel();
      e.preventDefault();
      // First Escape clears the text; a second one on an empty row leaves it.
      if (text) { setText(''); requestRef.current = null; } else inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && items[highlight]) pick(items[highlight]);
      else submitSentence();
    }
  };

  return (
    <div className={`health-suggest${inline ? ' health-suggest--inline' : ''}`}>
      <div className="health-suggest__field">
        <TextInput ref={inputRef} autoFocus={!inline} size="sm" value={text}
          placeholder={inline ? `Add to ${label}…` : 'Food name, or a sentence to parse…'}
          aria-label={inline ? `Add to ${label}` : 'Food name or sentence'} role="combobox"
          aria-expanded={open ? 'true' : 'false'} aria-controls={listId}
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          disabled={phase === 'parsing'}
          onFocus={() => { setFocused(true); if (inline) logger.debug('add-row.focus', { bucket: bucketId }); }}
          onBlur={() => setFocused(false)}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          rightSection={phase === 'parsing' ? <Loader size="xs" /> : null} />
        {actions}
      </div>
      {error ? <p className="health-suggest__error">{error.message}</p> : null}
      {/* preventDefault on mousedown keeps the input focused while a suggestion
          is pressed; otherwise blur closes the inline list before the click lands. */}
      {open ? <ul id={listId} className="health-suggest__list" role="listbox" aria-label="Suggested foods"
        onMouseDown={(e) => e.preventDefault()}>
        {items.map((entry, i) => {
          // The food's picture where it has one (PRD F5.3 asks for it here too).
          // A slug whose image fails is retired by NAME, so a later suggestion of
          // the same food does not re-request it — and the row simply loses the
          // icon rather than showing a broken image.
          return (
            <li key={`${entry.type ?? 'food'}:${entry.id}`}>
              <UnstyledButton
                id={`${listId}-${i}`} disabled={phase === 'parsing'}
                className={`health-suggest__item${entry.favorite ? ' health-suggest__item--fav' : ''}${i === highlight ? ' health-suggest__item--hi' : ''}`}
                role="option" aria-selected={i === highlight}
                onClick={() => pick(entry)}>
                {entry.favorite ? <span className="health-suggest__star" aria-label="favorite">★</span> : null}
                <FoodIcon icon={entry.icon} className="health-suggest__icon" />
                <span className="health-suggest__name">{entry.name}</span>
                {entry.type === 'template' ? (
                  // A meal-level suggestion is visually distinguished from a
                  // single food (PRD F8.2) by a NON-COLOUR cue: the item count.
                  <span className="health-suggest__badge">{`${entry.itemCount ?? 0} items`}</span>
                ) : null}
                <span className="health-suggest__kcal">{entry.grams > 0 ? `${Math.round(entry.grams)} g · ` : ''}{entry.nutrients?.calories ?? ''} kcal</span>
              </UnstyledButton>
            </li>
          );
        })}
      </ul> : null}
      {open && text.trim() ? <Button size="compact-sm" disabled={phase === 'parsing'} onClick={submitSentence}>Log sentence</Button> : null}
      {open && onMeals ? (
        <UnstyledButton className="health-suggest__saved-meals" onClick={onMeals}>
          Meals &amp; templates ▸
        </UnstyledButton>
      ) : null}
      {open && onManageFoods ? <UnstyledButton className="health-suggest__saved-meals" onClick={onManageFoods}>Manage saved foods ▸</UnstyledButton> : null}
    </div>
  );
}
export default AddCombobox;
