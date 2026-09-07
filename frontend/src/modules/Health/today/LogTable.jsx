import { useEffect, useState } from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { LoadingState } from '@/lib/ui';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { MacroBadges } from './MacroBadges.jsx';
import { ExerciseSection } from './ExerciseSection.jsx';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { EntryRow } from './EntryRow.jsx';
import { groupRows } from './groupRows.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { MealFoodControls } from './MealFoodControls.jsx';
import { CaptureProgress } from './CaptureProgress.jsx';
import { currentMealBucketId, localTodayISO } from './mealBuckets.js';
import './mealWorkflow.scss';

// Bucket totals fold through the SHARED counted-rows contract — the same file
// BudgetService folds the day's equation and macros with. A group row carries
// zero nutrition BY DESIGN (its children carry the real values as siblings in
// this same flat `rows` array), so summing every counted row already counts
// each gram of food exactly once; `sumCounted` says so once, for everyone.
const kcal = (rows) => Math.round(sumCounted(rows, 'calories'));

function Section({
  label, rows, onAdd, onRowTap, onConfirm, headerAction, coldLoading, pending,
  measuredByUuid, date, bucket, active, onVoiceCapture, onTextCapture, onChanged, captureTasks = [], onHoldChange, externalClarification, onClearClarification,
}) {
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState([]);
  const [localClarification, setClarification] = useState(null);
  const clarification = externalClarification === undefined ? localClarification : externalClarification;
  const [clarifying, setClarifying] = useState(false);
  const [clarifyError, setClarifyError] = useState(null);
  const selectedIds = selection.filter(id => rows.some(row => (row.uuid || row.id) === id));
  const captured = result => {
    if (externalClarification !== undefined) return result;
    if (result?.clarification) setClarification({...result.clarification, instructionText:result.instructionText || result.clarification.instructionText, selectedIds:[...selectedIds]});
    else setClarification(null);
    return result;
  };
  const renderRow = props => {
    const id = props.row.uuid || props.row.id;
    if (!selecting) return <EntryRow key={id} {...props}/>;
    const ids = props.isGroup ? props.row.children.map(row=>row.uuid || row.id) : [id];
    return <div key={id} className="health-meal-selection-row"><input type="checkbox" aria-label={`Select ${props.row.name || props.row.label || props.row.item}`}
      checked={ids.every(id=>selectedIds.includes(id))} onChange={e=>setSelection(prev=>e.target.checked?[...new Set([...prev,...ids])]:prev.filter(id=>!ids.includes(id)))}/><EntryRow {...props}/></div>;
  };
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('health:collapsed-dishes') || '[]')); }
    catch { return new Set(); }
  });
  const entries = groupRows(rows);
  // The section frame (heading + kcal + add row) is PERMANENT structure —
  // it never depends on whether data has arrived yet. Only the entry list
  // itself swaps for a shimmer, and only on a true cold start (this bucket
  // has no rows AND the day hasn't loaded once yet): a background
  // revalidation (SWR) or a bucket that is genuinely empty must never show
  // this — see LogTable's `coldLoading` prop, computed once by the caller
  // from `day.loading && !day.items.length`.
  const showShimmer = coldLoading && rows.length === 0;

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
    <section className="health-meal">
      <header className="health-meal__header">
        <h4 className="health-meal__label">{label}</h4>
        {rows.length ? <MacroBadges rows={rows} className="health-meal__macros" showLabels /> : null}
        <span className="health-meal__header-right">
          <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : '—'}</span>
          {onVoiceCapture ? <VoiceCapture active={active} bucket={bucket} mealLabel={label} onHoldChange={onHoldChange}
            onCapture={async (content,target,metadata)=>captured(await onVoiceCapture(content,target,{selectedIds,date,...metadata}))}/> : null}
          {onAdd ? <UnstyledButton className="health-meal__add" aria-label={`Add food to ${label}`} onClick={onAdd}>+</UnstyledButton> : null}
        </span>
      </header>
      {bucket && rows.length && onChanged ? <MealFoodControls date={date} bucket={bucket} rows={rows} selectedIds={selectedIds} selecting={selecting}
        extraActions={headerAction}
        onSelectionMode={value=>{setSelecting(value);if(!value)setSelection([]);}}
        onChanged={result=>{setSelection([]);setSelecting(false);onChanged(result);}}/> : null}
      {clarification ? <div className="health-meal-command-panel"><span>{clarification.question}</span>
        <div className="health-meal-command-actions">{clarification.choices.map(choice=><Button key={choice.id} size="compact-xs" disabled={clarifying} onClick={async()=>{
          setClarifying(true);setClarifyError(null);
          try { captured(await onTextCapture(clarification.instructionText,bucket,{date,selectedIds:clarification.selectedIds,clarification:choice.id})); }
          catch(err){setClarifyError(err.message);}
          finally{setClarifying(false);}
        }}>{choice.label}</Button>)}<Button size="compact-xs" variant="subtle" disabled={clarifying} onClick={()=>{setClarification(null);onClearClarification?.();}}>Cancel</Button></div>
        {clarifyError ? <span role="alert">{clarifyError}</span> : null}</div> : null}
      {showShimmer ? <LoadingState label={`${label} entries`} rows={2} /> : null}
      {!showShimmer && entries.map(({ row, children, rollup }) => {
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
          return renderRow({row,onTap:onRowTap,onConfirm,measured});
        }
        const isOpen = !collapsed.has(key);
        return (
          <div key={key} className="health-group">
            {/* `children` is attached to the row object here — not read
                by EntryRow's own rendering (which uses rollupKcal/isGroup
                for display) — purely so the tap handler forwards them to
                whatever opens next (EntryEditSheet's group mode needs the
                full child list to scale/move/delete them together). */}
            {renderRow({ row:{...row,children},densityRow:{kind:'group',children},onTap:onRowTap,onConfirm,measured,
              isGroup:true,expanded:isOpen,onToggle:()=>toggle(key),rollupKcal:rollup.calories })}
            {isOpen ? children.map((c,index)=>renderRow({row:c,onTap:onRowTap,onConfirm,child:true,lastChild:index===children.length-1,
              measured:measuredByUuid?.get(c.uuid) ?? measuredByUuid?.get(c.id) ?? null})) : null}
          </div>
        );
      })}
      {/* In-place AI-capture wait: shown where the result will land (this
          bucket), never as a page-level spinner. `aria-busy` on the row
          itself, not the whole section — the heading/kcal/add-row above
          stay fully interactive while a capture is in flight. */}
      {captureTasks.length ? captureTasks.map(task=><CaptureProgress key={task.id} startedAt={task.startedAt} label={`${label} food analysis`}/>) : pending ?
        <CaptureProgress startedAt={Date.now()} label={`${label} food analysis`}/> : null}
    </section>
  );
}

export function LogTable({
  byBucket, date, sessions = [], exerciseAvailable = false, onAddTo, onRowTap, onConfirm,
  addSlot, addingTo, bucketHeaderAction, coldLoading = false, capturePendingBucket = null, capturePendingBuckets = [],
  measuredByUuid = null, active = true, onVoiceCapture, onTextCapture, onMealChanged, captureTasks = [], clarifications, onClearClarification,
}) {
  const [, refreshClock] = useState(0);
  const [heldSections, setHeldSections] = useState(new Set());
  const holdSection = (key, held) => setHeldSections(previous => {
    if (previous.has(key) === held) return previous;
    const next = new Set(previous);
    if (held) next.add(key); else next.delete(key);
    return next;
  });
  useEffect(()=>{
    const refresh=()=>refreshClock(value=>value+1);
    const timer=setInterval(refresh,15000);
    window.addEventListener('focus',refresh);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const anticipated = date === localTodayISO() ? currentMealBucketId() : null;
  const visible = b => heldSections.has(`${date}:${b.id}`) || clarifications?.has(`${date}:${b.id}`) || coldLoading || byBucket.get(b.id)?.length || addingTo === b.id || anticipated === b.id || capturePendingBucket === b.id || capturePendingBuckets.includes(b.id);
  const orphans = byBucket.get(null) || [];
  return (
    <div className="health-log">
      {BUCKETS.filter(visible).map((b) => {
        const rows = byBucket.get(b.id) || [];
        return (
          <div key={`${date}:${b.id}`}>
            <Section label={b.label} rows={rows} date={date} bucket={b.id} active={active}
              onVoiceCapture={onVoiceCapture} onTextCapture={onTextCapture} onChanged={onMealChanged}
              onHoldChange={held=>holdSection(`${date}:${b.id}`,held)}
              externalClarification={clarifications === undefined ? undefined : clarifications.get(`${date}:${b.id}`) || null}
              onClearClarification={()=>onClearClarification?.(`${date}:${b.id}`)}
              captureTasks={captureTasks.filter(task=>task.date===date && task.bucket===b.id)}
              onAdd={() => onAddTo(b.id)} onRowTap={onRowTap} onConfirm={onConfirm}
              headerAction={bucketHeaderAction ? bucketHeaderAction(b.id, rows, b.label) : null}
              coldLoading={coldLoading} pending={capturePendingBucket === b.id || capturePendingBuckets.includes(b.id)}
              measuredByUuid={measuredByUuid} />
            {addingTo === b.id && addSlot ? addSlot : null}
          </div>
        );
      })}
      {!coldLoading ? <div className="health-log__empty-meals">{BUCKETS.filter(b => !visible(b)).map(b =>
        <UnstyledButton key={b.id} className="health-log__empty-add" aria-label={`Add food to ${b.label}`} onClick={() => onAddTo(b.id)}>+ {b.label}</UnstyledButton>)}</div> : null}
      {/* Gated on `exerciseAvailable` (budget data has arrived), NOT on
          `sessions.length` — a zero-session day is a real, stable answer
          ("no workout yet today"), not an absence of data. Gating on length
          alone made the header pop in and out as sessions changed, which is
          exactly the "chrome dissolves" problem this task exists to fix. */}
      {exerciseAvailable || sessions.length ? (
        <ExerciseSection date={date} sessions={sessions} />
      ) : null}
      {orphans.length ? (
        <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} onConfirm={onConfirm}
          measuredByUuid={measuredByUuid} />
      ) : null}
    </div>
  );
}
export default LogTable;
