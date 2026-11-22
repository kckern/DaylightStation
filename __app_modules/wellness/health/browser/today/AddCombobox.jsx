import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { TextInput, UnstyledButton, Loader, Button } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useAppMainRef } from '@/lib/ui/AppFrame.jsx';
import { observeVisualViewport } from '@/lib/ui/observeVisualViewport.js';
import { operationRequest } from "../capture/operationRequest.js";
import { FoodIcon } from "./FoodIcon.jsx";
import { nutritionPhotoUrl } from "./photoUrl.js";
import { reportArtworkFailure } from "./artworkLog.js";
import { formatFoodPortion } from '../../portable/contracts/health/foodQuantity.mjs';

/**
 * A suggestion's picture: the product photo a barcode scan left on the food
 * when there is one (legible where a 24px icon of "a drink" is not), else its
 * icon. A photo that will not load falls back to the icon and is reported to
 * the artwork queue.
 */
function SuggestArt({ entry }) {
  const [broken, setBroken] = useState(null);
  if (entry.photoRef && broken !== entry.photoRef) {
    return <img className="health-suggest__icon health-suggest__photo" alt="" loading="lazy" decoding="async"
      src={nutritionPhotoUrl(entry.photoRef, { thumb: true })}
      onError={() => { setBroken(entry.photoRef); reportArtworkFailure('photo', entry.photoRef, { name: entry.name, icon: entry.icon || null }); }} />;
  }
  return <FoodIcon icon={entry.icon} className="health-suggest__icon" />;
}

/** "325 ml · " for a label serving, "30 g · " for grams, nothing when unknown. */
function portionLabel(entry) {
  const portion = formatFoodPortion({
    grams: entry.grams,
    amount: entry.serving?.amount,
    unit: entry.serving?.unit,
  });
  return portion === '—' ? '' : `${portion} · `;
}
import { shortlistPath, showCommittedFoodRows, provisionalFoodRow, settleProvisionalRow } from "../healthResources.js";
import { localTodayISO, currentMealBucketId } from "./mealBuckets.js";
import { addedRowIds, trackAddFlow } from "./addFlow.js";

import { useHealthOperations } from "../operations/HealthOperationsProvider.jsx";

const logger = createAppLogger('health').child('add-combobox');
const EMPTY_ITEMS = [];

/** True when a committed sentence's rows were filed on a different day or meal than this row's. */
export function landedElsewhere(result, { date = null, bucketId = null } = {}) {
  if (result?.moved === true) return true;
  const landedDate = result?.date ?? result?.affectedDates?.[0] ?? result?.items?.find(item => item?.date)?.date ?? null;
  const landedMeal = result?.mealTime ?? result?.bucket ?? null;
  return Boolean((date && landedDate && landedDate !== date) || (bucketId && landedMeal && landedMeal !== bucketId));
}

/**
 * Where the inline popup fits: 'below' the input unless the visible viewport
 * (visualViewport — a phone keyboard shrinks it) has less room below than the
 * popup needs AND more room above.
 */
export function popupPlacement(fieldRect, popupHeight, viewport) {
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? 0);
  const below = bottom - fieldRect.bottom;
  const above = fieldRect.top - top;
  return below < popupHeight && above > below ? 'above' : 'below';
}

const visibleViewport = () => (typeof window === 'undefined' ? null
  : window.visualViewport ? { offsetTop: window.visualViewport.offsetTop, height: window.visualViewport.height }
    : { offsetTop: 0, height: window.innerHeight });

/**
 * `onFoodAdded(result, date, { added })` hears every committed add, including one
 * finished by a Retry. `added` marks a pick, which is new food by definition; a
 * sentence may instead have changed existing food. It returns true once the
 * person has been told where the food landed.
 */
export function AddCombobox({ bucketId, date = null, onDone, onFoodAdded = null, onCancel, onMeals, onTemplate, onManageFoods, onSentencePending = null,
  inline = false, label = null, focusRequest = 0, actions = null }) {
  const operations = useHealthOperations();
  const mainRef = useAppMainRef();
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [phase, setPhase] = useState('typing'); // typing | parsing
  const [error, setError] = useState(null);
  const submitting = useRef(false);
  const requestRef = useRef(null);
  const listId = useId();
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const popupRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const surface = inline ? 'inline' : 'sheet';
  // Inline rows sit on every visible meal at once, so each one fetches and
  // draws its shortlist only while it is being used. Leaving the row closes
  // the list but keeps any typed text; coming back reopens it.
  const open = !inline || focused;
  const query = text.trim();
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const queryPath = query === debouncedQuery
    ? `api/v1/health/nutrition/catalog/suggest?q=${encodeURIComponent(query)}${bucketId ? `&bucket=${encodeURIComponent(bucketId)}` : ''}`
    : null;
  const path = open ? (query ? queryPath : shortlistPath(bucketId)) : null;
  // A warm bucket shortlist paints immediately. Typed results are only used
  // for the current query and never retained in the persistent cache.
  const { data: suggestions } = useApiResource(path, {
    swr: !query, retryTransient: false, label: 'food suggestions', logger,
  });
  const items = suggestions?.items ?? EMPTY_ITEMS;
  useLayoutEffect(() => { setHighlight(-1); }, [path, suggestions]);
  // Near the bottom of a phone screen (or above the keyboard) the overlay
  // popup would run off the visible area: flip it above the input then.
  const [placement, setPlacement] = useState('below');
  useEffect(() => { if (focusRequest) inputRef.current?.focus(); }, [focusRequest]);
  // Focus moving between the input and its own popup (suggestions, Log
  // sentence, the two links) is still "in the row" — a Tab onto "Manage saved
  // foods" must not unmount the link it is landing on.
  const onRowBlur = (e) => {
    const next = e.relatedTarget;
    if (next && (next === inputRef.current || popupRef.current?.contains(next))) return;
    setFocused(false);
    setHighlight(-1);
  };
  // The input is never disabled (disabling a focused field blurs it, and on a
  // phone that closes the keyboard between every add). If focus did end up
  // outside anything focusable — a pressed button that went disabled while
  // parsing — hand it back to the input once the request settles, success or
  // error. Focus that went somewhere else on purpose is left alone.
  const prevPhase = useRef(phase);
  useEffect(() => {
    const was = prevPhase.current; prevPhase.current = phase;
    if (!inline || was !== 'parsing' || phase !== 'typing') return;
    const active = document.activeElement;
    if (!active || active === document.body || (active !== inputRef.current && rootRef.current?.contains(active))) inputRef.current?.focus();
  }, [phase, inline]);

  useLayoutEffect(() => {
    if (!inline || !open) return undefined;
    const field = rootRef.current;
    const popup = popupRef.current;
    if (!field || !popup) return undefined;
    const availableHeight = '--health-suggest-available-height';
    const place = () => {
      const viewport = visibleViewport();
      const main = mainRef?.current?.getBoundingClientRect();
      const top = Math.max(viewport.offsetTop, main?.top ?? viewport.offsetTop);
      const viewportBottom = viewport.offsetTop + viewport.height;
      const bottom = Math.min(viewportBottom, main?.bottom ?? viewportBottom);
      const anchor = field.getBoundingClientRect();
      // Measure before constraining the popup so a resize can choose either
      // side based on the content, regardless of the previous height.
      popup.style.removeProperty(availableHeight);
      const side = popupPlacement(anchor, popup.offsetHeight, { offsetTop: top, height: bottom - top });
      const room = side === 'above' ? anchor.top - top : bottom - anchor.bottom;
      popup.style.setProperty(availableHeight, `${Math.max(0, room)}px`);
      setPlacement(side);
    };
    const onScroll = event => {
      if (!popup.contains(event.target)) place();
    };
    const stopObserving = observeVisualViewport(place);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      stopObserving();
      document.removeEventListener('scroll', onScroll, true);
      popup.style.removeProperty(availableHeight);
    };
  }, [inline, open, items.length, text, mainRef]);

  // The sheet unmounts on success. The inline row stays: clear it and forget
  // the operation id (the next add is a new intent even when the payload is
  // identical). Focus never left the input, so the next food can be typed
  // straight away.
  const finish = (result) => {
    if (inline) {
      requestRef.current = null;
      setText(''); setHighlight(-1); setPhase('typing');
    }
    onDone?.(result);
  };

  // An inline pick shows its row and clears the field at once; the save runs
  // behind it. A pick is a deliberate choice of a known food, so the row that
  // the server will write is predictable from the suggestion. If the save
  // fails the row comes back out, the typed text returns, and the error shows.
  // The day reload (onDone) waits for the save: a reload that beat it would
  // wipe the row it has never heard of.
  const pickOptimistically = async (entry) => {
    const typed = text;
    const targetDate = date || localTodayISO();
    const provisional = provisionalFoodRow(entry, { date: targetDate, mealTime: bucketId || currentMealBucketId() });
    const request = operationRequest(requestRef,
      { catalogEntryId: entry.id, ...(bucketId ? { mealTime: bucketId } : {}), ...(date ? { date } : {}) });
    requestRef.current = null; // the next pick is a new intent, even for the same food
    setText(''); setHighlight(-1); setError(null);
    showCommittedFoodRows([provisional]);
    logger.info('quickadd.optimistic', { entry: entry.name, bucket: bucketId, surface });
    const submittedAt = performance.now();
    try {
      let response;
      if (operations) {
        operations.store.begin({ id: request.operationId, kind: 'quickadd', date: targetDate, bucket: bucketId, targetIds: [], label: entry.name,
          provisionalRow: provisional, request: { path: 'api/v1/health/nutrition/catalog/quickadd', body: request, method: 'POST' } });
        response = await operations.execute(request.operationId, result => { onFoodAdded?.(result, targetDate, { added: true }); });
        if (!operations.isActive()) return;
      } else {
        response = await DaylightAPI('api/v1/health/nutrition/catalog/quickadd', request, 'POST');
        onFoodAdded?.(response, targetDate, { added: true });
      }
      logger.info('quickadd.done', { entry: entry.name, bucket: bucketId, surface, saveMs: Math.round(performance.now() - submittedAt) });
      settleProvisionalRow(provisional, response?.item ?? null);
      trackAddFlow({ ids: addedRowIds(response), userId: operations?.snapshot.userId ?? null, date: operations ? targetDate : null, bucket: bucketId ?? null, surface, kind: 'pick', submitToCommittedMs: performance.now() - submittedAt });
      onDone?.();
    } catch (err) {
      logger.error('quickadd.failed', { error: err?.message });
      if (operations && !operations.isActive()) return;
      settleProvisionalRow(provisional, null);
      if (!operations) { setText(current => current || typed); setError(err); }
    }
  };

  const pick = async (entry) => {
    if (inline && entry?.type !== 'template') return pickOptimistically(entry);
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
    const submittedAt = performance.now();
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
      const response = await DaylightAPI(
        'api/v1/health/nutrition/catalog/quickadd',
        // The row lands on the day being VIEWED, in the meal row it was
      // launched from. Both keys are omitted when absent — absent still means
      // "today" / "the clock's meal" on the server.
      operationRequest(requestRef, { catalogEntryId: entry.id, ...(bucketId ? { mealTime: bucketId } : {}), ...(date ? { date } : {}) }),
        'POST',
      );
      logger.info('quickadd.done', { entry: entry.name, bucket: bucketId, surface });
      // The response IS the saved row: show it now. Waiting for the day
      // refetch left the add row cleared and the meal unchanged for seconds.
      showCommittedFoodRows(response?.item ? [response.item] : []);
      onFoodAdded?.(response, date || localTodayISO(), { added: true });
      trackAddFlow({ ids: addedRowIds(response), userId: operations?.snapshot.userId ?? null, date: operations ? (date || localTodayISO()) : null, bucket: bucketId ?? null, surface, kind: 'pick', submitToCommittedMs: performance.now() - submittedAt });
      finish();
    } catch (err) {
      logger.error('quickadd.failed', { error: err?.message });
      setError(err); setPhase('typing');
    } finally { submitting.current = false; }
  };

  const submitSentence = async () => {
    if (operations) {
      const submitted = text.trim();
      if (!submitted) return;
      const targetDate = date || localTodayISO();
      operations.submitSentence({ text: submitted, date: targetDate, bucket: bucketId, onResult: (result, operation) => {
        if (onFoodAdded?.(result, targetDate)) operations.store.transition(operation.id, { reported: true });
      } });
      setText(''); setHighlight(-1); setError(null);
      return;
    }
    if (!text.trim() || submitting.current) return;
    submitting.current = true;
    setPhase('parsing'); setError(null);
    logger.info('sentence.submit', { length: text.length });
    const submittedAt = performance.now();
    // The meal shows an "Adding …" row where the food will land, held until
    // the parsed rows are actually on the day (not just committed), so the
    // placeholder hands over to the real rows instead of leaving a gap.
    let release = null;
    try { release = onSentencePending?.(text.trim()) ?? null; } catch (err) { logger.warn('sentence.pending_failed', { error: err?.message }); }
    const settle = () => { const done = release; release = null; done?.(); };
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
        settle();
        setError(new Error(result?.message || 'No food was logged. Tweak the sentence and try again.'));
        setPhase('typing');
      } else {
        const flow = trackAddFlow({ ids: addedRowIds(result), bucket: bucketId ?? null, surface, kind: 'sentence', submitToCommittedMs: performance.now() - submittedAt });
        // Rows that landed on another day or meal ("…for lunch") will never
        // appear here: drop the placeholder now rather than after the timeout.
        if (landedElsewhere(result, { date, bucketId })) settle(); else flow.then(settle);
        onFoodAdded?.(result, date || localTodayISO());
        finish(result);
      }
    } catch (err) {
      settle();
      logger.error('sentence.failed', { error: err?.message });
      setError(err); setPhase('typing'); // text preserved — input never lost
    } finally { submitting.current = false; }
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return;
    if (submitting.current) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (!inline) return onCancel();
      e.preventDefault();
      // First Escape clears the text; a second one on an empty row leaves it.
      if (text) { setText(''); setError(null); requestRef.current = null; } else inputRef.current?.blur();
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
    <div ref={rootRef} className={`health-suggest${inline ? ' health-suggest--inline' : ''}${inline && placement === 'above' ? ' health-suggest--above' : ''}`}>
      <div className="health-suggest__field">
        <TextInput ref={inputRef} autoFocus={!inline} size="sm" value={text}
          placeholder={inline ? `Add to ${label}…` : 'Food name, or a sentence to parse…'}
          aria-label={inline ? `Add to ${label}` : 'Food name or sentence'} role="combobox"
          aria-expanded={open ? 'true' : 'false'} aria-controls={open ? listId : undefined}
          aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
          readOnly={phase === 'parsing'} aria-busy={phase === 'parsing' ? 'true' : undefined}
          onFocus={() => { if (!focused && inline) logger.debug('add-row.focus', { bucket: bucketId }); setFocused(true); }}
          onBlur={onRowBlur}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
          rightSection={phase === 'parsing' ? <Loader size="xs" /> : null} />
        {actions}
      </div>
      {error ? <p className="health-suggest__error">{error.message}</p> : null}
      {/* Everything the row opens lives in one popup. preventDefault on
          mousedown keeps the input focused while anything in it is pressed;
          otherwise blur would close the inline popup before the click lands. */}
      {open ? <div ref={popupRef} className="health-suggest__popup" onMouseDown={(e) => e.preventDefault()} onBlur={onRowBlur}>
      <ul id={listId} className="health-suggest__list" role="listbox" aria-label="Suggested foods">
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
                <SuggestArt entry={entry} />
                <span className="health-suggest__name">{entry.name}</span>
                {entry.type === 'template' ? (
                  // A meal-level suggestion is visually distinguished from a
                  // single food (PRD F8.2) by a NON-COLOUR cue: the item count.
                  <span className="health-suggest__badge">{`${entry.itemCount ?? 0} items`}</span>
                ) : null}
                <span className="health-suggest__kcal">{portionLabel(entry)}{entry.nutrients?.calories ?? ''} kcal</span>
              </UnstyledButton>
            </li>
          );
        })}
      </ul>
      {text.trim() ? <Button size="compact-sm" disabled={phase === 'parsing'} onClick={submitSentence}>Log sentence</Button> : null}
      {onMeals ? (
        <UnstyledButton className="health-suggest__saved-meals" onClick={onMeals}>
          Meals &amp; templates ▸
        </UnstyledButton>
      ) : null}
      {onManageFoods ? <UnstyledButton className="health-suggest__saved-meals" onClick={onManageFoods}>Manage saved foods ▸</UnstyledButton> : null}
      </div> : null}
    </div>
  );
}
export default AddCombobox;
