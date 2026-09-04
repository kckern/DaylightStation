import { useState } from 'react';
import { ActionIcon, UnstyledButton } from '@mantine/core';
import { LoadingState } from '@/lib/ui';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { BUCKETS, UNGROUPED } from './mealBuckets.js';
import { EntryRow } from './EntryRow.jsx';
import { groupRows } from './groupRows.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';

// Same inline-SVG pattern as TodayView.jsx's footer BarcodeIcon — duplicated
// rather than shared to avoid a LogTable <-> TodayView circular import
// (TodayView already imports LogTable).
const BarcodeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 3v12M5 3v12M7.5 3v12M10 3v12M13 3v12M16 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Opens the barcode-scan sheet, pre-targeted at this meal's bucket. */
function MealBarcodeButton({ label, onClick }) {
  return (
    <ActionIcon aria-label={`Scan barcode to ${label}`} className="health-meal__capture-btn" onClick={onClick}>
      <BarcodeIcon />
    </ActionIcon>
  );
}

// Bucket totals fold through the SHARED counted-rows contract — the same file
// BudgetService folds the day's equation and macros with. A group row carries
// zero nutrition BY DESIGN (its children carry the real values as siblings in
// this same flat `rows` array), so summing every counted row already counts
// each gram of food exactly once; `sumCounted` says so once, for everyone.
const kcal = (rows) => Math.round(sumCounted(rows, 'calories'));

// Per-meal macro subtotal (Task 6.3), on that same predicate. Returns null when
// the meal has no macro data at all, so a day of legacy rows shows
// "P 0 · C 0 · F 0" nowhere.
const MACRO_SUBTOTAL = [['protein', 'P'], ['carbs', 'C'], ['fat', 'F']];
const macroLine = (rows) => {
  const totals = MACRO_SUBTOTAL.map(([key, letter]) => [letter, Math.round(sumCounted(rows, key))]);
  if (!totals.some(([, value]) => value > 0)) return null;
  return totals.map(([letter, value]) => `${letter} ${value}`).join(' · ');
};

function Section({
  label, rows, onAdd, onRowTap, onConfirm, headerAction, coldLoading, pending,
  bucketId, onVoiceCapture, onPhotoCapture, onOpenBarcode, captureBusy, measuredByUuid,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const entries = groupRows(rows);
  const macros = macroLine(rows);
  // The section frame (heading + kcal + add row) is PERMANENT structure —
  // it never depends on whether data has arrived yet. Only the entry list
  // itself swaps for a shimmer, and only on a true cold start (this bucket
  // has no rows AND the day hasn't loaded once yet): a background
  // revalidation (SWR) or a bucket that is genuinely empty must never show
  // this — see LogTable's `coldLoading` prop, computed once by the caller
  // from `day.loading && !day.items.length`.
  const showShimmer = coldLoading && rows.length === 0;

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <section className="health-meal">
      <header className="health-meal__header">
        <h4 className="health-meal__label">{label}</h4>
        <span className="health-meal__header-right">
          <span className="health-meal__kcal">{rows.length ? `${kcal(rows)} kcal` : '—'}</span>
          {/* Per-meal capture controls (Task 4.2) — only present when this
              Section IS a real meal bucket (bucketId set); the Ungrouped /
              orphans Section below never passes one, so no capture trio
              renders there. */}
          {bucketId ? (
            <span className="health-meal__capture">
              <VoiceCapture bucket={bucketId} mealLabel={label} busy={captureBusy} onCapture={onVoiceCapture} />
              <PhotoCapture bucket={bucketId} mealLabel={label} busy={captureBusy} onCapture={onPhotoCapture} />
              <MealBarcodeButton label={label} onClick={() => onOpenBarcode(bucketId)} />
            </span>
          ) : null}
          {headerAction || null}
        </span>
      </header>
      {macros ? <div className="health-meal__macros">{macros}</div> : null}
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
          return <EntryRow key={key} row={row} onTap={onRowTap} onConfirm={onConfirm} measured={measured} />;
        }
        const isOpen = expanded.has(key);
        return (
          <div key={key} className="health-group">
            {/* `children` is attached to the row object here — not read
                by EntryRow's own rendering (which uses rollupKcal/isGroup
                for display) — purely so the tap handler forwards them to
                whatever opens next (EntryEditSheet's group mode needs the
                full child list to scale/move/delete them together). */}
            <EntryRow
              row={{ ...row, children }} onTap={onRowTap} onConfirm={onConfirm} measured={measured}
              isGroup expanded={isOpen} onToggle={() => toggle(key)} rollupKcal={rollup.calories}
            />
            {isOpen ? children.map((c) => (
              <EntryRow key={c.uuid ?? c.id} row={c} onTap={onRowTap} onConfirm={onConfirm} child
                measured={measuredByUuid?.get(c.uuid) ?? measuredByUuid?.get(c.id) ?? null} />
            )) : null}
          </div>
        );
      })}
      {/* In-place AI-capture wait: shown where the result will land (this
          bucket), never as a page-level spinner. `aria-busy` on the row
          itself, not the whole section — the heading/kcal/add-row above
          stay fully interactive while a capture is in flight. */}
      {pending ? (
        <div className="health-row health-row--pending" aria-busy="true">
          <span className="health-row__name">Analyzing…</span>
        </div>
      ) : null}
      {onAdd ? (
        <UnstyledButton className="health-meal__add" onClick={onAdd}>+ Add food…</UnstyledButton>
      ) : null}
    </section>
  );
}

export function LogTable({
  byBucket, sessions = [], exerciseAvailable = false, onAddTo, onRowTap, onConfirm,
  addSlot, addingTo, bucketHeaderAction, coldLoading = false, capturePendingBucket = null,
  onVoiceCapture, onPhotoCapture, onOpenBarcode, captureBusy = false, measuredByUuid = null,
}) {
  const orphans = byBucket.get(null) || [];
  return (
    <div className="health-log">
      {BUCKETS.map((b) => {
        const rows = byBucket.get(b.id) || [];
        return (
          <div key={b.id}>
            <Section label={b.label} rows={rows}
              onAdd={() => onAddTo(b.id)} onRowTap={onRowTap} onConfirm={onConfirm}
              headerAction={bucketHeaderAction ? bucketHeaderAction(b.id, rows, b.label) : null}
              coldLoading={coldLoading} pending={capturePendingBucket === b.id}
              bucketId={b.id} onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture}
              onOpenBarcode={onOpenBarcode} captureBusy={captureBusy} measuredByUuid={measuredByUuid} />
            {addingTo === b.id && addSlot ? addSlot : null}
          </div>
        );
      })}
      {/* Gated on `exerciseAvailable` (budget data has arrived), NOT on
          `sessions.length` — a zero-session day is a real, stable answer
          ("no workout yet today"), not an absence of data. Gating on length
          alone made the header pop in and out as sessions changed, which is
          exactly the "chrome dissolves" problem this task exists to fix. */}
      {exerciseAvailable || sessions.length ? (
        <section className="health-meal health-meal--exercise">
          <header className="health-meal__header">
            <h4 className="health-meal__label">Exercise</h4>
            <span className="health-meal__kcal">{sessions.length ? `+${kcal(sessions)} kcal` : '—'}</span>
          </header>
          {sessions.map((s, i) => (
            <div key={i} className="health-row health-row--readonly">
              <span className="health-row__name">{s.type || s.title || 'Workout'}</span>
              <span className="health-row__portion">{(s.minutes ?? s.duration_min) ? `${Math.round(s.minutes ?? s.duration_min)} min` : ''}</span>
              <span className="health-row__kcal">+{Math.round(s.calories || 0)}</span>
            </div>
          ))}
        </section>
      ) : null}
      {orphans.length ? (
        <Section label={UNGROUPED.label} rows={orphans} onRowTap={onRowTap} onConfirm={onConfirm}
          measuredByUuid={measuredByUuid} />
      ) : null}
    </div>
  );
}
export default LogTable;
