import { useMemo, useState } from 'react';
import { Button } from '@mantine/core';
import { ErrorState } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { WeekStrip, addDays } from './WeekStrip.jsx';
import { MacroBarRow } from './MacroBarRow.jsx';
import { WeightChip } from './WeightChip.jsx';
import { MonthBlock } from './MonthBlock.jsx';
import { useBudgetRange } from './useBudgetRange.js';
import { useIsWideViewport } from './layout.js';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { NeedsReviewSection } from './NeedsReviewSection.jsx';
import { ObservationsSection } from './ObservationRow.jsx';
import { EntryEditSheet } from './EntryEditSheet.jsx';
import { SavedMealsSheet } from './SavedMealsSheet.jsx';
import { QuickCaptureBar } from './QuickCaptureBar.jsx';
import { localTodayISO as todayISO, currentMealBucketId, bucketLabel } from './mealBuckets.js';
import { useNutritionInput } from '../capture/useNutritionInput.js';
import { BarcodeCapture } from '../capture/BarcodeCapture.jsx';
import { CustomFoodSheet } from '../capture/CustomFoodSheet.jsx';

const logger = createAppLogger('health').child('today');

export function TodayView({ onSetupGoals, onCoachTap }) {
  const [date, setDate] = useState(todayISO());
  const day = useHealthDay(date);
  const [addingTo, setAddingTo] = useState(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet
  const [captureMode, setCaptureMode] = useState(null); // 'barcode' | null
  // bucketId | null — which meal's header-row barcode button opened the
  // sheet (null = an unlabeled launch; QuickCaptureBar always passes its
  // own clock-derived default, never null). Forwarded to BarcodeCapture so
  // it can hand the same id back on decode.
  const [barcodeTargetBucket, setBarcodeTargetBucket] = useState(null);
  const [unknownUpc, setUnknownUpc] = useState(null);
  const [savedMealsFor, setSavedMealsFor] = useState(null); // bucketId | null — F8's saved-meals picker
  const [captureNotice, setCaptureNotice] = useState(null); // string | null — e.g. "no food detected"
  // bucketId | null — set the instant an AI capture (photo/voice/barcode)
  // submit starts, cleared in a `finally` once the result (success OR
  // failure) comes back. LogTable renders the "Analyzing…" placeholder row
  // in this exact bucket — the wait is shown where the result will land,
  // never as a page-level spinner.
  const [capturePending, setCapturePending] = useState(null);
  const nutrition = useNutritionInput();
  // The desktop sidebar's widgets are 30-day surfaces. Gating the MOUNT on the
  // breakpoint (not just hiding them in CSS) is what stops a phone fetching a
  // month of budgets for a column it will never show.
  const wideViewport = useIsWideViewport();
  // ONE 30-day request, fetched here and handed to every sidebar widget that
  // needs it. Each widget owning its own useBudgetRange would make the same
  // request twice on one page load — the hook's cache dedupes the SECOND load,
  // not two simultaneous mounts.
  const monthEnd = date < todayISO() ? date : todayISO();
  const monthRange = useBudgetRange(addDays(monthEnd, -29), monthEnd, { enabled: wideViewport });
  const dash = useApiResource('api/v1/health/dashboard', { label: 'dashboard', logger });
  // Pending NutriLogs for the viewed date. Text/image/voice/barcode captures
  // now land immediately as accepted+unsettled rows in the nutrilist (Task 1.1),
  // so they no longer show up here. The scale bridge's multi-step composition
  // flow still mints status:'pending' logs (not replaced until a later phase)
  // and a pending log never syncs into the nutrilist that day.byBucket is
  // built from — so this stays as the scale's off-surface visibility fix.
  const pendingReview = useApiResource(`api/v1/health/nutrition/pending?date=${date}`,
    { deps: [date], label: 'pending-review', logger });
  // Only surface scale-origin pending logs — the other sources (telegram,
  // web) no longer mint pending rows now that captures commit on arrival.
  const scalePending = (pendingReview.data?.pending || []).filter((p) => p.source === 'scale');
  // The DURABLE kitchen-scale ledger for this date (Task 5.4). Distinct from
  // `pendingReview` above, which is about NutriLogs awaiting Accept/Discard:
  // these are the raw signals underneath — a settled weight, a scanned
  // density/tare — which exist whether or not any log was ever created from
  // them. `swr:true` for the same reason the day itself uses it: a reload
  // after a dismiss/pair revalidates quietly instead of blanking the section.
  const observations = useApiResource(`api/v1/health/nutrition/observations?date=${date}`,
    { deps: [date], label: 'observations', logger, swr: true });
  const observationRows = useMemo(() => observations.data?.observations || [], [observations.data]);
  // Signals nobody has attached to anything — rendered at the top of the day
  // with a Dismiss affordance. Dismissing is the ONLY thing that resolves a
  // row which aged out of the scale's 900 s composition window.
  const unmatched = useMemo(() => observationRows.filter((o) => o.status === 'open'), [observationRows]);
  // uuid -> "82 g · scale ✓". Built ONCE per day, not per row: one entry can
  // carry SEVERAL observations (a placement appends a weight row per >=5 g
  // change, plus a container and a density), so the badge reports the latest
  // weight among them rather than assuming one row per entry.
  const measuredByUuid = useMemo(() => {
    const byEntry = new Map();
    for (const o of observationRows) {
      if (o.status !== 'consumed' || !o.pairedEntryUuid) continue;
      const bucket = byEntry.get(o.pairedEntryUuid) || [];
      bucket.push(o);
      byEntry.set(o.pairedEntryUuid, bucket);
    }
    const out = new Map();
    for (const [uuid, rows] of byEntry) {
      const weights = rows.filter((o) => o.kind === 'weight');
      const latest = weights.length
        ? weights.reduce((a, b) => (String(b.at) >= String(a.at) ? b : a))
        : null;
      out.set(uuid, latest ? `${latest.value} ${latest.unit || 'g'} · scale ✓` : 'scale ✓');
    }
    return out;
  }, [observationRows]);
  // dashboard.today.coaching is an array of {type, text, timestamp} — text is
  // multi-line HTML-flavored copy (a full "morning brief"), not a one-liner.
  // Take the first line of the most recent entry and strip markup for the
  // footer's single-line affordance; real payload only, nothing fabricated.
  const coachLine = useMemo(() => {
    const text = dash.data?.today?.coaching?.[0]?.text;
    if (!text) return null;
    const firstLine = text.split('\n')[0].replace(/<[^>]+>/g, '').trim();
    return firstLine || null;
  }, [dash.data]);

  // Past-day bucket → today, via a saved-meal template used purely as
  // transport (created, immediately logged to today, then discarded).
  const copyMealToToday = async (rows, bucketId, label) => {
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    try {
      const { meal } = await DaylightAPI('api/v1/health/nutrition/meals', { name: `Copied ${label}`, items }, 'POST');
      await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}/log`, { date: todayISO(), mealTime: bucketId }, 'POST');
      await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}`, {}, 'DELETE');
      logger.info('copy-to-today', { bucketId, count: items.length });
      day.reload();
    } catch (err) {
      logger.error('copy-to-today.failed', { bucketId, error: err?.message });
      setCaptureNotice(`Couldn't copy ${label.toLowerCase()} to today — try again.`);
    }
  };

  // Today's bucket → a named, kept saved meal (US-2.2).
  const saveBucketAsMeal = async (rows, label) => {
    const name = window.prompt('Name this meal:', `My ${label.toLowerCase()}`);
    if (!name) return;
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    try {
      await DaylightAPI('api/v1/health/nutrition/meals', { name, items }, 'POST');
      logger.info('save-bucket-as-meal', { name, count: items.length });
    } catch (err) {
      logger.error('save-bucket-as-meal.failed', { name, error: err?.message });
      setCaptureNotice(`Couldn't save "${name}" as a meal — try again.`);
    }
  };

  // Photo/voice/barcode submissions land immediately as an already-logged
  // (unsettled) NutriLog (food detected — the day reload shows it in place
  // with the unsettled cue) or as a plain status message (e.g. "no food
  // detected") with no choices at all. The no-food-detected case must still
  // be shown — silently discarding it is exactly the "no visible result"
  // failure the spec forbids (I-4, final review 2026-09-02).
  //
  // THE MOVED CUE (Task 4.2): the backend's meal-resolution precedence is
  // "named meal in the utterance/caption" > "the bucket we sent" > "the
  // clock". When an explicitly-named meal overrides a DIFFERENT bucket than
  // the one this capture targeted, the response carries `moved: true` +
  // the resolved `mealTime` — e.g. tapping the mic on the Breakfast row but
  // saying "log this for lunch" must not silently land the entry under
  // Breakfast with no explanation. Reuse the existing captureNotice banner
  // rather than inventing a second notice mechanism.
  const handleCaptureResult = (result) => {
    if (result?.moved) {
      setCaptureNotice(`Moved to ${bucketLabel(result.mealTime)}`);
      day.reload();
      return;
    }
    const messages = result?.messages || [];
    const hasChoices = messages.some((m) => (m.choices || []).flat().length > 0);
    if (!hasChoices) {
      const text = messages[0]?.text;
      if (text) setCaptureNotice(text);
      return;
    }
    day.reload();
  };

  // Wraps any capture submit (photo/voice/barcode) with the in-place pending
  // placeholder: mark the bucket a new entry would land in NOW as pending
  // before the request goes out, always clear it afterward regardless of
  // outcome — a failed capture must not leave a stuck "Analyzing…" row.
  // `bucket` is the explicit per-meal target (from a meal-row capture
  // button, or QuickCaptureBar's own clock-derived default); when absent we
  // fall back to the same currentMealBucketId() guess as before — this is
  // ONLY where the placeholder shows, never the backend's actual
  // resolution.
  const submitWithPending = async (type, content, { bucket } = {}) => {
    const bucketId = bucket || currentMealBucketId();
    setCapturePending(bucketId);
    try {
      return await nutrition.submit(type, content, { bucket });
    } finally {
      setCapturePending(null);
    }
  };

  // Shared by QuickCaptureBar's global Voice/Photo triggers AND every
  // per-meal header trigger LogTable renders — VoiceCapture/PhotoCapture
  // forward `(dataUrl, bucket)`, with `bucket` always the clock-derived
  // default for QuickCaptureBar's instances and the specific meal's id for
  // LogTable's.
  const handleVoiceOrPhotoCapture = async (type, dataUrl, bucket) => {
    handleCaptureResult(await submitWithPending(type, dataUrl, { bucket }));
  };
  const onVoiceCapture = (dataUrl, bucket) => handleVoiceOrPhotoCapture('voice', dataUrl, bucket);
  const onPhotoCapture = (dataUrl, bucket) => handleVoiceOrPhotoCapture('image', dataUrl, bucket);

  // Opens the barcode sheet, pre-targeted at a meal's bucket — LogTable's
  // per-meal trigger passes that meal's id; QuickCaptureBar passes its own
  // clock-derived default.
  const openBarcode = (bucketId = null) => {
    setBarcodeTargetBucket(bucketId);
    setCaptureMode('barcode');
  };

  const bucketHeaderAction = (bucketId, rows, label) => {
    if (!rows.length) return null;
    if (date !== todayISO()) {
      return <Button size="compact-xs" variant="subtle" onClick={() => copyMealToToday(rows, bucketId, label)}>Copy to today</Button>;
    }
    return <Button size="compact-xs" variant="subtle" onClick={() => saveBucketAsMeal(rows, label)}>Save as meal</Button>;
  };

  // The day's STRUCTURE (headings, section frames, add rows) renders
  // unconditionally via LogTable below — this only decides whether a
  // section's BODY shows a shimmer in place of its (still-empty) entries.
  // True cold start = never loaded this date before (no SWR cache hit) AND
  // still loading; a background revalidation after a mutation leaves
  // `day.loading` false the whole time, so it never re-triggers this.
  const coldLoading = day.loading && !day.items.length;

  return (
    <div className="health-today">
      <EquationStrip budget={day.budget} budgetError={day.budgetError}
        date={date} today={todayISO()} onDateChange={setDate} onSetupGoals={onSetupGoals} />
      {/* Macro / watch-micro bars sit directly under the equation (F4.1). They
          read the SAME day sums the equation does — BudgetService computes both
          over one fold — so the bars and the kcal number can never disagree. */}
      <MacroBarRow macros={day.budget?.macros} goals={day.budget?.goals}
        microCoverage={day.budget?.microCoverage} />
      {/* Weight sits between the macro bars and the week strip: it is the other
          number the budget is computed FROM, so it belongs beside the equation
          rather than buried in the Progress tab. */}
      {/* ONE instance of each of these in the JSX. On a phone this element is
          simply the next block in the stack — which puts the weight chip
          directly under the macro bars, where Task 8.3 wants it; at
          $health-aside-breakpoint the same element becomes the right column.
          Nothing is rendered twice and hidden. */}
      <aside className="health-today__aside">
        <WeightChip />
        {wideViewport ? <MonthBlock days={monthRange.days} loading={monthRange.loading} /> : null}
      </aside>
      <WeekStrip date={date} today={todayISO()} onDateChange={setDate} />
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {captureNotice ? (
        <div className="health-pending" role="status">
          <p className="health-pending__line">{captureNotice}</p>
          <div className="health-pending__actions">
            <Button size="xs" variant="subtle" onClick={() => setCaptureNotice(null)}>Dismiss</Button>
          </div>
        </div>
      ) : null}
      <NeedsReviewSection pending={scalePending}
        onChanged={() => { pendingReview.reload(); day.reload(); }} />
      <ObservationsSection observations={unmatched} onChanged={() => observations.reload()} />
      <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
        exerciseAvailable={Boolean(day.budget)}
        coldLoading={coldLoading} capturePendingBucket={capturePending}
        onAddTo={setAddingTo} onRowTap={setEditingRow} onConfirm={day.reload} addingTo={addingTo}
        bucketHeaderAction={bucketHeaderAction}
        onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture}
        onOpenBarcode={openBarcode} captureBusy={nutrition.busy}
        measuredByUuid={measuredByUuid}
        addSlot={addingTo ? (
          <AddCombobox bucketId={addingTo}
            onDone={() => { setAddingTo(null); day.reload(); }}
            onCancel={() => setAddingTo(null)}
            onSavedMeals={() => setSavedMealsFor(addingTo)} />
        ) : null} />
      <MacroFooter items={day.items} coachLine={coachLine} onCoachTap={onCoachTap} />
      <QuickCaptureBar onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture}
        onOpenBarcode={openBarcode} onAddTo={setAddingTo} busy={nutrition.busy} />
      <BarcodeCapture open={captureMode === 'barcode'} busy={nutrition.busy} bucket={barcodeTargetBucket}
        onClose={() => { setCaptureMode(null); setBarcodeTargetBucket(null); }}
        onDecode={async (upc, bucket) => {
          const result = await submitWithPending('barcode', upc, { bucket });
          if (result?.unknownUpc) { setCaptureMode(null); setUnknownUpc(result.upc); return; }
          setCaptureMode(null);
          if (result?.moved) setCaptureNotice(`Moved to ${bucketLabel(result.mealTime)}`);
          day.reload();
        }} />
      <CustomFoodSheet upc={unknownUpc} open={Boolean(unknownUpc)}
        onClose={() => setUnknownUpc(null)}
        onCreated={() => { setUnknownUpc(null); day.reload(); }} />
      <EntryEditSheet row={editingRow} open={Boolean(editingRow)}
        onClose={() => setEditingRow(null)} onChanged={day.reload}
        observations={observationRows}
        onPaired={(err) => {
          // Re-pairing rewrites BOTH sides — the ledger and the entry's grams —
          // so both resources reload. A refusal (the store cannot rewrite two
          // months atomically) comes back as a message rather than silence:
          // nothing was changed, and the person needs to know that.
          observations.reload();
          day.reload();
          if (err) setCaptureNotice(err.message);
        }} />
      <SavedMealsSheet open={Boolean(savedMealsFor)} bucketId={savedMealsFor}
        onLogged={() => { setSavedMealsFor(null); setAddingTo(null); day.reload(); }}
        onClose={() => setSavedMealsFor(null)} />
    </div>
  );
}
export default TodayView;
