import { useHealthOperations } from "../operations/HealthOperationsProvider.jsx";
import { FoodOperationStatus } from "../operations/FoodOperationStatus.jsx";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, NativeSelect } from '@mantine/core';
import { CHROME_SCROLL_CLASS, LoadingState } from '@/lib/ui';
import { sumCounted } from "../../portable/contracts/nutrition/countedRows.mjs";
import { MacroBadges } from "./MacroBadges.jsx";
import { ExerciseSection } from "./ExerciseSection.jsx";
import { BUCKETS, UNGROUPED, EARLY_COLUMN, LATE_COLUMN, bucketLabel, localTodayISO } from "./mealBuckets.js";
import { EntryRow } from "./EntryRow.jsx";
import { groupRows, sortEntriesByCalories, calorieShares, dayCalorieScale } from "./groupRows.js";
import { MealFoodControls } from "./MealFoodControls.jsx";
import { MealFastToggle } from "./MealFastToggle.jsx";
import { MoveDayControl, MoveMealControl, DayDropDock } from "./MoveDayControl.jsx";
import { CaptureProgress } from "./CaptureProgress.jsx";
import { usePortionControl } from "./usePortionDraft.js";
import { useFrozenOrder, useFlipMoves } from "./sectionOrder.js";
import { MealDragProvider, MoveResult, useMealDropTarget, useDraggableMeal } from "./mealDrag.jsx";
import { dayLabel } from "./moveDays.js";
import { RowPreviewProvider } from "./RowPreview.jsx";
import { useDishMembership, dishCandidates } from "./dishMembership.js";
import "./mealWorkflow.scss";

// Bucket totals fold through the SHARED counted-rows contract — the same file
// BudgetService folds the day's equation and macros with. A group row carries
// zero nutrition BY DESIGN (its children carry the real values as siblings in
// this same flat `rows` array), so summing every counted row already counts
// each gram of food exactly once; `sumCounted` says so once, for everyone.
// A typed sentence parses faster than a photo or a recording.
const SENTENCE_ESTIMATE_MS = 6000;
const NO_IDS = new Set();
const OWN_REPORTING = /\/nutrition\/(day-input|foods-move|meal-undo)$/;

const kcal = (rows) => Math.round(sumCounted(rows, 'calories'));

function Section({
  label, rows, renderAddRow = null, onRowTap, onConfirm, onRequestDelete, headerAction, coldLoading, pending,
  measuredByUuid, addedIds = null, kcalScale = null, date, bucket, onVoiceCapture, onTextCapture, onChanged, captureTasks = [], externalClarification, onClearClarification,
  fasted = false, onFastChanged = null, selecting = false, onSelectionMode = () => {}, onMealCommandDone = () => {}, selection = [], setSelection = () => {},
}) {
  const [localClarification, setClarification] = useState(null);
  const clarification = externalClarification === undefined ? localClarification : externalClarification;
  const operations = useHealthOperations();
  // The day input, food moves and their Undos report through their own surfaces
  // and the page's toasts (mealDrag.jsx), so none of them belong in a meal.
  const sentenceOperations = [...(operations?.snapshot.operations.values() || [])].filter(op => !operations?.snapshot.operations.get(op.parentId)?.resumable && !OWN_REPORTING.test(op.request?.path || '')).filter(op => (op.kind === 'sentence' || (['mutation', 'quickadd'].includes(op.kind) && op.error)) && op.date === date && op.bucket === bucket);
  const [clarifying, setClarifying] = useState(false);
  const [clarifyError, setClarifyError] = useState(null);
  // The day's selection spans meals; this meal's voice and commands get only its own foods.
  const selectedIds = selection.filter(id => rows.some(row => (row.uuid || row.id) === id));
  const captured = result => {
    if (externalClarification !== undefined) return result;
    if (result?.clarification) setClarification({...result.clarification, instructionText:result.instructionText || result.clarification.instructionText, selectedIds:[...selectedIds]});
    else setClarification(null);
    return result;
  };
  const renderRow = rowProps => {
    const id = rowProps.row.uuid || rowProps.row.id;
    // Just added from an add row: a brief highlight so the eye finds it even
    // when the heaviest-first sort lands it mid-list.
    const shown = addedIds?.has(String(id)) ? { ...rowProps, added: true } : rowProps;
    // Rows drag to other meals, except while picking foods for a command.
    const props = selecting ? shown : { ...shown, dragBucket: bucket };
    if (!selecting) return <EntryRow key={id} {...props}/>;
    // A dish ticks through its parts; some of them ticked shows as mixed.
    const ids = props.isGroup ? props.row.children.map(row=>row.uuid || row.id) : [id];
    const ticked = ids.filter(id=>selectedIds.includes(id)).length;
    const all = ticked === ids.length;
    const setTicked = on => setSelection(prev=>on?[...new Set([...prev,...ids])]:prev.filter(id=>!ids.includes(id)));
    return <div key={id} className="health-meal-selection-row" data-entry-key={props.entryKey}>
      <label className="health-meal-selection-tick"><input type="checkbox" aria-label={`Select ${props.row.name || props.row.label || props.row.item}`}
        ref={node=>{ if (node) node.indeterminate = ticked > 0 && !all; }} checked={all} onChange={e=>setTicked(e.target.checked)}/></label>
      <EntryRow {...props} selecting onTap={()=>setTicked(!all)}/></div>;
  };
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('health:collapsed-dishes') || '[]')); }
    catch { return new Set(); }
  });
  // Heaviest first, and each calorie cell carries its share of the meal's
  // largest entry (an ingredient: of its dish) for the inline bar.
  // While a portion/numeric drag (or its save) is live, the order holds still
  // so the dragged row stays under the pointer; values still update. When the
  // order does change, rows glide to their new places (sectionOrder.js).
  const portionState = usePortionControl();
  const portionDraft = Boolean(portionState?.drafts?.some(draft => draft.row.mealTime === bucket) || (!portionState?.drafts && portionState?.draft));
  const entries = useFrozenOrder(sortEntriesByCalories(groupRows(rows)), portionDraft);
  const sectionRef = useRef(null);
  const drop = useMealDropTarget(bucket);
  // The header drags the whole meal: every top-level entry, dishes with their ingredients.
  const mealRows = entries.map(({ row, children }) => (children.length ? { ...row, children } : row));
  const mealDrag = useDraggableMeal(selecting ? null : bucket, mealRows);
  useFlipMoves(sectionRef, entries.map(({ row }) => row.uuid ?? row.id).join('|'));
  // One scale for the whole day (LogTable's kcalScale): bars compare across rows, meals and ingredients.
  const entryShares = calorieShares(entries.map(({ row, children, rollup }) => (children.length ? rollup.calories : row.calories)), kcalScale);
  // The section frame (heading + kcal + add row) is PERMANENT structure —
  // it never depends on whether data has arrived yet. Only the entry list
  // itself swaps for a shimmer, and only on a true cold start (this bucket
  // has no rows AND the day hasn't loaded once yet): a background
  // revalidation (SWR) or a bucket that is genuinely empty must never show
  // this — see LogTable's `coldLoading` prop, computed once by the caller
  // from `day.loading && !day.items.length`.
  const showShimmer = coldLoading && rows.length === 0;
  // The meal's one mic lives in its add row. With foods selected it carries
  // the selection, so what is said edits those foods; with none it adds.
  const voiceCapture = onVoiceCapture
    ? async (content, target, metadata) => captured(await onVoiceCapture(content, target, { selectedIds, date, ...metadata }))
    : null;
  const addRow = renderAddRow ? renderAddRow(bucket, label, { selectedIds, onVoiceCapture: voiceCapture }) : null;

  // Add/remove an ingredient in place — only in a real meal, not while picking foods.
  const dish = useDishMembership({ date, bucket, rows, onChanged });
  const dishEditable = Boolean(bucket && onChanged && !selecting);
  const toggle = (key) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try {
      // Other meal sections may have changed since this section mounted.
      const stored = new Set(JSON.parse(sessionStorage.getItem('health:collapsed-dishes') || '[]'));
      if (next.has(key)) stored.add(key); else stored.delete(key);
      sessionStorage.setItem('health:collapsed-dishes', JSON.stringify([...stored]));
    } catch { /* Storage is optional. */ }
    return next;
  });

  return (
    <section className={['health-meal', drop.dragging && 'health-meal--drop-candidate', drop.over && 'health-meal--drop-over'].filter(Boolean).join(' ')}
      ref={node => { sectionRef.current = node; drop.ref(node); }}>
      <header ref={mealDrag.ref} {...mealDrag.handlers}
        className={['health-meal__header', mealDrag.draggable && 'health-meal__header--draggable', mealDrag.dragging && 'health-meal__header--dragging'].filter(Boolean).join(' ')}>
        <h4 className="health-meal__label">{label}</h4>
        {rows.length ? <MacroBadges rows={rows} className="health-meal__macros" showLabels /> : null}
        <span className="health-meal__header-right">
          <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : fasted ? 'Skipped' : '—'}</span>
          {/* An empty meal can be declared skipped (coach information only). A
              skipped meal that later gets food keeps its undo — and says so —
              or the coach would go on being told not to ask about it. */}
          {rows.length && fasted ? <span className="health-meal__fasted-note">marked skipped</span> : null}
          {(!rows.length || fasted) && !coldLoading && bucket && date && onFastChanged
            ? <MealFastToggle date={date} bucket={bucket} label={label} fasted={fasted} onChanged={onFastChanged} /> : null}
        </span>
      </header>
      {bucket && rows.length && onChanged ? <MealFoodControls date={date} bucket={bucket} rows={rows} selectedIds={selectedIds} selecting={selecting}
        extraActions={headerAction}
        onSelectionMode={on => onSelectionMode(on, sectionRef.current)}
        onChanged={result=>{onMealCommandDone(selectedIds);onChanged(result);}}/> : null}
      {clarification ? <div className="health-meal-command-panel"><span>{clarification.question}</span>
        <div className="health-meal-command-actions">{clarification.choices.map(choice=><Button key={choice.id} size="compact-xs" disabled={clarifying} onClick={async()=>{
          setClarifying(true);setClarifyError(null);
          try { captured(await onTextCapture(clarification.instructionText,bucket,{date,selectedIds:clarification.selectedIds,clarification:choice.id})); }
          catch(err){setClarifyError(err.message);}
          finally{setClarifying(false);}
        }}>{choice.label}</Button>)}<Button size="compact-xs" variant="subtle" disabled={clarifying} onClick={()=>{setClarification(null);onClearClarification?.();}}>Cancel</Button></div>
        {clarifyError ? <span role="alert">{clarifyError}</span> : null}</div> : null}
      {showShimmer ? <LoadingState label={`${label} entries`} rows={2} /> : null}
      {!showShimmer && entries.map(({ row, children, rollup }, entryIndex) => {
        const key = row.uuid ?? row.id;
        // Render as a group whenever groupRows() actually attached
        // children — NEVER gate this on row.kind. groupRows() attaches a
        // child to ANY row its parentId resolves to, regardless of the
        // parent's kind, and nothing upstream guarantees only
        // kind:'group' rows carry children. Gating on kind here would
        // silently drop the children from the screen.
        //
        // CROSS-REFERENCE: EntryEditSheet.jsx's group mode and the backend
        // cascade (HealthOperations#cascadeMealTimeToChildren) gate the
        // OPPOSITE way — strictly on `row.kind === 'group'`, never on "has
        // children" — because they must never act on a row nothing marked
        // as a group. The two decisions are equivalent only as long as
        // every write path stamps kind:'group' before ever giving a row
        // children (true today — groupParsedItems.mjs). If a future write
        // path breaks that invariant, this file would still show the
        // group collapsed, but the edit sheet would treat it as a plain
        // item (no rename/scale-group/cascade) — keep both sites' logic in
        // sync if that invariant ever needs to change.
        const isGroup = children.length > 0;
        // "This row's grams came off the scale." Looked up by uuid, falling back to
        // `id` for the same reason `key` does: not every row shape carries both.
        const measured = measuredByUuid?.get(row.uuid) ?? measuredByUuid?.get(row.id) ?? null;
        if (!isGroup) {
          return renderRow({row,onTap:onRowTap,onConfirm,onRequestDelete,onChanged,measured,kcalShare:entryShares[entryIndex],entryKey:String(key)});
        }
        const isOpen = !collapsed.has(key);
        const childShares = calorieShares(children.map(child => child.calories), kcalScale);
        return (
          <div key={key} className="health-group" data-entry-key={String(key)}>
            {/* `children` is attached to the row object here — not read
                by EntryRow's own rendering (which uses rollupKcal/isGroup
                for display) — purely so the tap handler forwards them to
                whatever opens next (EntryEditSheet's group mode needs the
                full child list to scale/move/delete them together). */}
            {renderRow({ row:{...row,children},densityRow:{kind:'group',children},onTap:onRowTap,onConfirm,onRequestDelete,onChanged,measured,kcalShare:entryShares[entryIndex],
              isGroup:true,expanded:isOpen,onToggle:()=>toggle(key),rollupKcal:rollup.calories })}
            {isOpen ? children.map((c,index)=>renderRow({row:c,onTap:onRowTap,onConfirm,onRequestDelete,onChanged,child:true,lastChild:index===children.length-1 && !dishEditable,kcalShare:childShares[index],
              measured:measuredByUuid?.get(c.uuid) ?? measuredByUuid?.get(c.id) ?? null})) : null}
            {isOpen && dishEditable ? <DishAddRow dishName={row.name || row.item || row.label} candidates={dishOptions(rows, key)}
              busy={dish.isBusy ? dish.isBusy(key) : dish.busy === key} error={dish.error?.groupId === key ? dish.error.message : null} onAdd={foodId=>dish.add(key,foodId)}/> : null}
            {/* Holds the line's height while picking foods, so the rows below stay put. */}
            {isOpen && selecting && bucket && onChanged ? <div className="health-row-line health-dish-add" aria-hidden="true" style={{ visibility: 'hidden' }} /> : null}
          </div>
        );
      })}
      {/* In-place AI-capture wait: shown where the result will land (this
          bucket), never as a page-level spinner. `aria-busy` on the row
          itself, not the whole section — the heading/kcal/add-row above
          stay fully interactive while a capture is in flight. */}
      {captureTasks.length ? captureTasks.map(task=><CaptureProgress key={task.id} startedAt={task.startedAt} label={`${label} food analysis`}
        text={task.text ?? null} estimateMs={task.text ? SENTENCE_ESTIMATE_MS : undefined}/>) : pending ?
        <CaptureProgress startedAt={Date.now()} label={`${label} food analysis`}/> : null}
      {/* The meal's add input is its last child, so a new food is typed right
          under the foods it joins. */}
      {sentenceOperations.map(operation => <FoodOperationStatus key={operation.id} operation={operation} />)}
      {addRow}
    </section>
  );
}

const rowName = row => row.name || row.item || row.label;
// An ingredient of another dish says where it comes from: picking it moves it.
const dishOptions = (rows, groupId) => dishCandidates(rows, groupId).map(row => {
  const from = row.parentId ? rows.find(other => (other.uuid ?? other.id) === row.parentId) : null;
  return { id: row.uuid ?? row.id, label: from ? `${rowName(row)} (from ${rowName(from)})` : rowName(row) };
});

// The last line of an open dish: fold another food of this meal into it.
// Foods from another dish move over (the old dish retires if emptied).
function DishAddRow({ dishName, candidates, busy, error, onAdd }) {
  return <div className="health-row-line health-row-line--child health-row-line--last-child health-dish-add">
    <div className="health-row__branch" />
    <label className="health-dish-add__field">
      <span className="health-dish-add__plus" aria-hidden="true">+</span>
      <NativeSelect size="xs" variant="unstyled" aria-label={`Add a food to ${dishName}`} value="" disabled={busy || !candidates.length}
        onChange={event=>{ if (event.currentTarget.value) onAdd(event.currentTarget.value); }}
        data={[{ value: '', label: busy ? 'Saving…' : candidates.length ? `Add food to ${dishName}…` : 'No other foods in this meal' },
          ...candidates.map(({ id, label }) => ({ value: id, label }))]} />
    </label>
    {error ? <span role="alert" className="health-row__error">{error}</span> : null}
  </div>;
}

/**
 * The ticked foods, across every meal, ready for one move. It stays for all of
 * selection mode at one height (health.scss), so ticks and server replies never
 * move the log. A dish counts only when every ingredient is ticked. The ticks
 * stay unless the foods actually moved.
 */
function DaySelectionBar({ barRef, byBucket, date, selection, moving, setMoving, onMoveToDay, onMoveMeal, onDone, onNotice }) {
  const picked = [];
  let partial = 0;
  for (const bucket of BUCKETS) for (const { row, children } of groupRows(byBucket.get(bucket.id) || [])) {
    if (!children.length) { if (selection.includes(row.uuid ?? row.id)) picked.push(row); continue; }
    const ticked = children.filter(child => selection.includes(child.uuid ?? child.id)).length;
    if (ticked === children.length) picked.push({ ...row, children }); else partial += ticked;
  }
  const today = localTodayISO();
  const finish = async (move, alreadyThere) => {
    setMoving(true);
    try {
      const result = await move();
      if (result === MoveResult.UNCHANGED) onNotice?.(alreadyThere);
      else if (result !== MoveResult.NOT_MOVED && result !== MoveResult.UNKNOWN) onDone(date);
    } finally { setMoving(false); }
  };
  return <div ref={barRef} role="region" aria-label="Selected foods" className="health-selection-bar">
    <div className="health-selection-bar__status" aria-live="polite">
      {picked.length ? <span>{picked.length} selected</span> : null}
      {partial ? <span className="health-selection-bar__note">Tick every ingredient to move a dish.</span> : null}
      {!picked.length && !partial ? <span>Tick foods to move</span> : null}
    </div>
    <div className="health-selection-bar__actions">
      {picked.length && onMoveToDay ? <MoveDayControl date={date} today={today} count={picked.length} disabled={moving}
        onMove={iso => finish(() => onMoveToDay(picked, iso), `Already on ${dayLabel(iso, today)}`)} /> : null}
      {picked.length && onMoveMeal ? <MoveMealControl count={picked.length} disabled={moving}
        onMove={meal => finish(() => onMoveMeal(picked, meal, null), `Already in ${bucketLabel(meal)}`)} /> : null}
    </div>
  </div>;
}

export function LogTable({
  byBucket, date, sessions = [], exerciseAvailable = false, onRowTap, onConfirm, onRequestDelete,
  bucketHeaderAction, coldLoading = false, capturePendingBucket = null, capturePendingBuckets = [],
  measuredByUuid = null, onVoiceCapture, onTextCapture, onMealChanged, captureTasks = [], clarifications, onClearClarification,
  renderAddRow = null, addedIds = null, onMoveEntry = null, onMoveMeal = null, onMoveToDay = null,
  fastedMeals = [], onMealFastChanged = null, onNotice = null, hiddenIds = NO_IDS,
}) {
  // "Select foods" spans the viewed day's meals and ends with that day.
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelectionState] = useState([]);
  const [moving, setMoving] = useState(false);
  const logRef = useRef(null);
  const barRef = useRef(null);
  const viewedDate = useRef(date);
  viewedDate.current = date;
  // The ref is the current selection, so a command finishing can read what was
  // ticked while it ran.
  const latestSelection = useRef(selection);
  const setSelection = change => {
    const next = typeof change === 'function' ? change(latestSelection.current) : change;
    latestSelection.current = next;
    setSelectionState(next);
    return next;
  };
  // The bar sits above the log, so opening it takes height and closing gives it
  // back. The scroller absorbs the difference and the foods stay put. This code is
  // the only thing correcting the position: the browser's scroll anchoring would
  // otherwise make the same correction, so it is off for the change.
  const scrollerOf = node => node?.closest(`.${CHROME_SCROLL_CLASS}`) || null;
  const holdScrollAnchoring = () => {
    const scroller = scrollerOf(logRef.current);
    if (!scroller) return;
    scroller.style.overflowAnchor = 'none';
    requestAnimationFrame(() => requestAnimationFrame(() => { scroller.style.overflowAnchor = ''; }));
  };
  // Focus inside the bar would be lost with it. Only a close of the open bar on
  // this day is recorded: a late move can call this after selection ended, and a
  // day change resets the page by itself.
  const closing = useRef(null);
  const opening = useRef(null);
  const selectingNow = useRef(selecting);
  selectingNow.current = selecting;
  const closeSelection = () => {
    if (selectingNow.current) {
      holdScrollAnchoring();
      const active = document.activeElement;
      closing.current = {
        date: viewedDate.current,
        top: logRef.current?.getBoundingClientRect().top ?? 0,
        refocus: !active || active === document.body || Boolean(barRef.current?.contains(active)),
      };
    }
    setSelection([]); setSelecting(false);
  };
  useLayoutEffect(() => {
    if (selecting) {
      const opened = opening.current;
      opening.current = null;
      const scroller = scrollerOf(opened?.anchor);
      if (!scroller || !opened.anchor.isConnected) return;
      scroller.scrollTop += opened.anchor.getBoundingClientRect().top - opened.top;
      // The one exception to holding still: the bar must not land on the control just tapped.
      const control = opened.anchor.querySelector('[data-select-foods]');
      const covered = control && barRef.current ? barRef.current.getBoundingClientRect().bottom - control.getBoundingClientRect().top : 0;
      if (covered > 0) scroller.scrollTop -= covered;
      return;
    }
    const closed = closing.current;
    const log = logRef.current;
    closing.current = null;
    if (!closed || !log || closed.date !== date) return;
    const scroller = scrollerOf(log);
    if (scroller) scroller.scrollTop += log.getBoundingClientRect().top - closed.top;
    if (!closed.refocus) return;
    const target = log.querySelector('[data-select-foods]') || log;
    if (target === log) log.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [selecting]);
  useEffect(() => { closing.current = null; setSelecting(false); setSelection([]); }, [date]);
  // Ticks follow the day's foods. A move hides its rows until it settles, and they
  // return if it fails, so nothing is forgotten while one is running, whichever
  // control started it (`hiddenIds` covers moves from outside the selection bar).
  useEffect(() => {
    if (!selecting || moving || coldLoading) return;
    const present = new Set([...byBucket.values()].flat().flatMap(row => [row.uuid, row.id]));
    hiddenIds.forEach(id => present.add(id));
    setSelection(previous => (previous.every(id => present.has(id)) ? previous : previous.filter(id => present.has(id))));
    // No meal has foods, so no meal shows the control that ends selection.
    if (!hiddenIds.size && !BUCKETS.some(bucket => byBucket.get(bucket.id)?.length)) closeSelection();
  }, [byBucket, selecting, moving, coldLoading, hiddenIds]);
  // A move can finish after the person has gone to another day and started there.
  const selectionMoved = movedFrom => { if (movedFrom === viewedDate.current) closeSelection(); };
  // A command in one meal settles that meal's ticks; other meals keep theirs.
  const mealCommandDone = ids => {
    if (!setSelection(previous => previous.filter(id => !ids.includes(id))).length) closeSelection();
  };
  const selectionMode = (on, anchor = null) => {
    if (!on) { closeSelection(); return; }
    if (!selectingNow.current && anchor) {
      holdScrollAnchoring();
      opening.current = { anchor, top: anchor.getBoundingClientRect().top };
    }
    setSelecting(true);
  };
  // All four meals always render: an empty one is its header and add row, so
  // any meal can be added to in place without a separate "add to" control.
  const orphans = byBucket.get(null) || [];
  // Each meal's add line starts where the food names start, so typed text
  // stacks under the names. Measured from a real top-level row (the density
  // badge, its placement preference and the phone tracks all move it) and
  // shared as --health-name-inset, so an empty meal lines up too.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return undefined;
    const measure = () => {
      const name = log.querySelector('.health-row-line:not(.health-row-line--child) .health-row__name');
      const section = name?.closest('.health-meal');
      if (!name || !section) return;
      const inset = Math.max(0, Math.round(name.getBoundingClientRect().left - section.getBoundingClientRect().left));
      if (log.style.getPropertyValue('--health-name-inset') !== `${inset}px`) log.style.setProperty('--health-name-inset', `${inset}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(log);
    return () => observer.disconnect();
  }, [byBucket]);
  const kcalScale = dayCalorieScale([...byBucket.values()]);
  const renderBucket = (b) => {
    const rows = byBucket.get(b.id) || [];
    return (
      <div key={`${date}:${b.id}`}>
        <Section label={b.label} rows={rows} date={date} bucket={b.id}
          onVoiceCapture={onVoiceCapture} onTextCapture={onTextCapture} onChanged={onMealChanged}
          externalClarification={clarifications === undefined ? undefined : clarifications.get(`${date}:${b.id}`) || null}
          onClearClarification={()=>onClearClarification?.(`${date}:${b.id}`)}
          captureTasks={captureTasks.filter(task=>task.date===date && task.bucket===b.id)}
          onRowTap={onRowTap} onConfirm={onConfirm} onRequestDelete={onRequestDelete}
          headerAction={bucketHeaderAction ? bucketHeaderAction(b.id, rows, b.label) : null}
          coldLoading={coldLoading} pending={capturePendingBucket === b.id || capturePendingBuckets.includes(b.id)}
          measuredByUuid={measuredByUuid} addedIds={addedIds} kcalScale={kcalScale} renderAddRow={renderAddRow}
          fasted={fastedMeals.includes(b.id)} onFastChanged={onMealFastChanged}
          selecting={selecting} onSelectionMode={selectionMode} onMealCommandDone={mealCommandDone} selection={selection} setSelection={setSelection} />
      </div>
    );
  };
  // Gated on `exerciseAvailable` (budget data has arrived), NOT on
  // `sessions.length` — a zero-session day is a real, stable answer
  // ("no workout yet today"), not an absence of data. Gating on length
  // alone made the header pop in and out as sessions changed.
  const showExercise = exerciseAvailable || sessions.length > 0;
  // The bar sits beside the grid, not in it: a sticky grid item can travel only
  // within its own grid row, which here is exactly as tall as the bar.
  const log = <div className="health-log-frame">
    {selecting ? <DaySelectionBar barRef={barRef} byBucket={byBucket} date={date} selection={selection} moving={moving} setMoving={setMoving}
      onMoveToDay={onMoveToDay} onMoveMeal={onMoveMeal} onDone={selectionMoved} onNotice={onNotice} /> : null}
    <div className="health-log" ref={logRef}>
      {[EARLY_COLUMN, LATE_COLUMN].map((ids, index) => (
        <div key={index} className="health-log__column">
          {ids.map(id => BUCKETS.find(b => b.id === id)).map(renderBucket)}
          {/* Workouts sit under Snacks, a meal-width column like any food. */}
          {index === 1 && showExercise ? <ExerciseSection date={date} sessions={sessions} /> : null}
        </div>
      ))}
      {orphans.length ? (
        <div className="health-log__wide">
          <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} onConfirm={onConfirm} onRequestDelete={onRequestDelete}
            measuredByUuid={measuredByUuid} kcalScale={kcalScale} />
        </div>
      ) : null}
    </div>
  </div>;
  // One preview card for the whole day, at the cursor (RowPreview.jsx).
  const withPreview = <RowPreviewProvider>{log}</RowPreviewProvider>;
  return onMoveEntry || onMoveMeal || onMoveToDay
    ? <MealDragProvider onMove={onMoveEntry} onMoveMeal={onMoveMeal} onMoveToDay={onMoveToDay}>
      {withPreview}
      {onMoveToDay ? <DayDropDock date={date} today={localTodayISO()} /> : null}
    </MealDragProvider> : withPreview;
}
export default LogTable;
