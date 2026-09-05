import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isISODate } from '@shared-contracts/health/isoDate.mjs';
import { ActionIcon, Button, Menu } from '@mantine/core';
import { ErrorState } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { WeekStrip, addDays, weekEnd } from './WeekStrip.jsx';
import { MacroBarRow } from './MacroBarRow.jsx';
import { WeightChip } from './WeightChip.jsx';
import { MonthBlock } from './MonthBlock.jsx';
import { useBudgetRange } from './useBudgetRange.js';
import { useIsWideViewport } from './layout.js';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { NeedsReviewSection } from './NeedsReviewSection.jsx';
import { CleanupQuestions } from '../cleanup/CleanupQuestions.jsx';
import { ObservationsSection } from './ObservationRow.jsx';
import { EntryEditor } from './EntryEditor.jsx';
import { TemplatePicker } from './TemplatePicker.jsx';
import { FoodCatalogManager } from './FoodCatalogManager.jsx';
import { QuickCaptureBar } from './QuickCaptureBar.jsx';
import { localTodayISO as todayISO, currentMealBucketId, bucketLabel } from './mealBuckets.js';
import { useNutritionInput } from '../capture/useNutritionInput.js';
import { BarcodeCapture } from '../capture/BarcodeCapture.jsx';
import { CustomFoodSheet } from '../capture/CustomFoodSheet.jsx';

const logger = createAppLogger('health').child('today');
const IntakeBurnChart = lazy(() => import('../progress/IntakeBurnChart.jsx').then(module => ({ default: module.IntakeBurnChart })));

export function TodayView({ active = true, onSetupGoals, onCoachTap }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const date = isISODate(dateParam) && dateParam <= todayISO() ? dateParam : todayISO();
  const setDate = (value) => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('date', value); next.set('week', weekEnd(value)); return next; });
  const weekParam = searchParams.get('week');
  const viewportEnd = isISODate(weekParam) && weekParam <= weekEnd(todayISO()) ? weekEnd(weekParam) : weekEnd(date);
  const day = useHealthDay(date, { enabled: active });
  const [addingTo, setAddingTo] = useState(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet
  const [captureMode, setCaptureMode] = useState(null); // 'barcode' | null
  // bucketId | null — which meal's header-row barcode button opened the
  // sheet (null = an unlabeled launch; QuickCaptureBar always passes its
  // own clock-derived default, never null). Forwarded to BarcodeCapture so
  // it can hand the same id back on decode.
  const [barcodeTargetBucket, setBarcodeTargetBucket] = useState(null);
  const [unknownUpc, setUnknownUpc] = useState(null);
  // bucketId | null — which meal's add row opened the template picker
  // (PRD F6.3: one meals surface, and this is it).
  const [templatesFor, setTemplatesFor] = useState(null);
  const [manageFoods, setManageFoods] = useState(false);
  // template id | null — set when the add-combobox picked a MEAL suggestion,
  // so the picker opens straight onto its variant step (PRD F8.2 → F6.1).
  const [focusTemplateId, setFocusTemplateId] = useState(null);
  const [captureNotice, setCaptureNotice] = useState(null); // string | null — e.g. "no food detected"
  const [undoDelete, setUndoDelete] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const undoPending = useRef(false);
  const [barcodeDate, setBarcodeDate] = useState(date);
  // { audioRef, bucket } | null — a voice capture whose transcription failed on
  // the network. The recording is on the server, so the notice can offer a
  // retry that re-uses it rather than asking for it again.
  const [captureRetry, setCaptureRetry] = useState(null);
  // bucketId | null — set the instant an AI capture (photo/voice/barcode)
  // submit starts, cleared in a `finally` once the result (success OR
  // failure) comes back. LogTable renders the "Analyzing…" placeholder row
  // in this exact bucket — the wait is shown where the result will land,
  // never as a page-level spinner.
  const [capturePending, setCapturePending] = useState(new Map());
  const copyOperations = useRef(new Map());
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
  const monthRange = useBudgetRange(addDays(monthEnd, -29), monthEnd, { enabled: active && wideViewport });
  const dash = useApiResource('api/v1/health/dashboard', { enabled: active, label: 'dashboard', logger });
  // Review belongs to the shared food log, regardless of capture surface.
  // In particular, scanner/Telegram UPC captures can remain pending until
  // a portion is confirmed. Health must offer confirmation for those too.
  const pendingReview = useApiResource(`api/v1/health/nutrition/pending?date=${date}`,
    { deps: [date], enabled: active, label: 'pending-review', logger, swr: true });
  const pendingLogs = pendingReview.data?.pending || [];
  // The DURABLE kitchen-scale ledger for this date (Task 5.4). Distinct from
  // `pendingReview` above, which is about NutriLogs awaiting Accept/Discard:
  // these are the raw signals underneath — a settled weight, a scanned
  // density/tare — which exist whether or not any log was ever created from
  // them. `swr:true` for the same reason the day itself uses it: a reload
  // after a dismiss/pair revalidates quietly instead of blanking the section.
  const observations = useApiResource(`api/v1/health/nutrition/observations?date=${date}`,
    { deps: [date], enabled: active, label: 'observations', logger, swr: true });
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

  // Copy snapshots in one idempotent command, without temporary templates.
  const copyMealToToday = async (rows, bucketId, label) => {
    const entryIds = rows.map(row => row.uuid || row.id);
    const key = JSON.stringify([entryIds, bucketId, todayISO()]);
    const prior = copyOperations.current.get(key);
    if (prior?.pending) return;
    const operation = prior || { id: crypto.randomUUID() };
    operation.pending = true; copyOperations.current.set(key, operation);
    try {
      await DaylightAPI('api/v1/health/nutrition/copy', { entryIds, date: todayISO(), mealTime: bucketId, operationId: operation.id }, 'POST');
      logger.info('copy-to-today', { bucketId, count: rows.length });
      setCaptureNotice(`${label} copied to today.`);
      copyOperations.current.delete(key);
      day.reload();
    } catch (err) {
      logger.error('copy-to-today.failed', { bucketId, error: err?.message });
      setCaptureNotice(`Couldn't copy ${label.toLowerCase()} to today — try again.`);
    } finally { operation.pending = false; }
  };

  // Today's bucket → a named, kept TEMPLATE (US-2.2, US-6.3).
  //
  // It writes a template, not a saved meal, because the template picker is now
  // the only surface that lists kept meals (PRD F6.3). A meal saved to the
  // meals store from here would be written to a file nothing renders — the
  // exact stranding the parity check for retiring `SavedMealsSheet` had to
  // rule out. Copy-day-to-today uses the dedicated snapshot-copy command.
  const saveBucketAsMeal = async (rows, label) => {
    const name = window.prompt('Name this meal:', `My ${label.toLowerCase()}`);
    if (!name) return;
    // All-core: nothing here knows which parts rotate, and guessing would drop
    // food out of the meal the next time it is logged.
    // Micros and their provenance travel with the snapshot: a template built
    // from provenanced rows must instantiate rows that still report covered,
    // or saving a meal would quietly downgrade the day's micro coverage.
    const components = rows.filter(row => row.kind !== 'group').map((r) => ({
      ...r,
      name: r.name || r.item, role: 'core',
      calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
      fiber: r.fiber, sugar: r.sugar, sodium: r.sodium, cholesterol: r.cholesterol,
      microsSource: r.microsSource ?? null,
      color: r.color, icon: r.icon ?? null, grams: r.grams, unit: r.unit, amount: r.amount,
    }));
    try {
      await DaylightAPI('api/v1/health/nutrition/templates', { name, components }, 'POST');
      logger.info('save-bucket-as-template', { name, count: components.length });
    } catch (err) {
      logger.error('save-bucket-as-template.failed', { name, error: err?.message });
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
  const handleCaptureResult = (result, bucket = null, targetDate = date) => {
    // Offer the retry BEFORE the message is rendered, so the sentence that
    // says the recording is saved arrives with the button that uses it.
    setCaptureRetry(result?.transcribeFailed && result?.audioRef
      ? { audioRef: result.audioRef, bucket: bucket || currentMealBucketId(), date: targetDate }
      : null);
    if (result?.committed) day.reload();
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
  const submitWithPending = async (type, content, { bucket, audioRef, date: targetDate = date } = {}) => {
    const bucketId = bucket || currentMealBucketId();
    const pendingId = crypto.randomUUID();
    setCapturePending(previous => new Map(previous).set(pendingId, { bucket: bucketId, date: targetDate }));
    try {
      // THE VIEWED DAY TRAVELS WITH THE CAPTURE. Without it the row is dated by
      // the server's clock, so food entered while looking at yesterday appeared
      // on today — the defect this closes. Only the LOGICAL date follows the
      // view; createdAt/settledAt stay real wall-clock instants.
      return await nutrition.submit(type, content, { bucket, date: targetDate, audioRef });
    } catch (err) {
      setCaptureNotice(err?.message || 'Capture interrupted. Retry to check its result.');
      throw err;
    } finally {
      setCapturePending(previous => { const next = new Map(previous); next.delete(pendingId); return next; });
    }
  };

  // Shared by QuickCaptureBar's global Voice/Photo triggers AND every
  // per-meal header trigger LogTable renders — VoiceCapture/PhotoCapture
  // forward `(dataUrl, bucket)`, with `bucket` always the clock-derived
  // default for QuickCaptureBar's instances and the specific meal's id for
  // LogTable's.
  const handleVoiceOrPhotoCapture = async (type, dataUrl, bucket) => {
    handleCaptureResult(await submitWithPending(type, dataUrl, { bucket }), bucket);
  };

  // A transcription that failed on the network left the RECORDING on the
  // server (VoiceMemoStore). Retrying re-sends its ref, so the person never
  // has to say it again — which is the only thing that makes persisting it
  // worth doing. A ref the server can no longer find comes back as a 404 with
  // a sentence, and the retry affordance retires with it.
  const retryVoiceCapture = async () => {
    if (!captureRetry) return;
    const { audioRef, bucket, date: targetDate } = captureRetry;
    setCaptureNotice(null);
    try {
      handleCaptureResult(await submitWithPending('voice', null, { bucket, audioRef, date: targetDate }), bucket, targetDate);
    } catch (err) {
      logger.error('capture.retry.failed', { audioRef, error: err?.message });
      setCaptureNotice('Retry failed. The saved recording is still selected; try again when connected.');
    }
  };
  const onVoiceCapture = (dataUrl, bucket) => handleVoiceOrPhotoCapture('voice', dataUrl, bucket);
  const onPhotoCapture = (dataUrl, bucket) => handleVoiceOrPhotoCapture('image', dataUrl, bucket);

  // Opens the barcode sheet, pre-targeted at a meal's bucket — LogTable's
  // per-meal trigger passes that meal's id; QuickCaptureBar passes its own
  // clock-derived default.
  const openBarcode = (bucketId = null) => {
    setBarcodeTargetBucket(bucketId);
    setBarcodeDate(date);
    setCaptureMode('barcode');
  };

  const bucketHeaderAction = (bucketId, rows, label) => {
    if (!rows.length) return null;
    return <Menu position="bottom-end">
      <Menu.Target><ActionIcon className="health-meal__capture-btn" variant="subtle" aria-label={`${label} actions`}>⋯</ActionIcon></Menu.Target>
      <Menu.Dropdown>
        {date !== todayISO() ? <Menu.Item onClick={() => copyMealToToday(rows, bucketId, label)}>Copy to today</Menu.Item> : null}
        <Menu.Item onClick={() => saveBucketAsMeal(rows, label)}>Save as meal</Menu.Item>
      </Menu.Dropdown>
    </Menu>;
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
        {active ? <WeightChip /> : null}
        {wideViewport ? <MonthBlock days={monthRange.days} loading={monthRange.loading} /> : null}
        {/* Same `days` the month block just used — a second useBudgetRange here
            would be a second identical request on every desktop page load. */}
        {wideViewport ? <Suspense fallback={null}><IntakeBurnChart days={monthRange.days} loading={monthRange.loading} /></Suspense> : null}
      </aside>
      <WeekStrip enabled={active} date={date} today={todayISO()} onDateChange={setDate} viewportEnd={viewportEnd}
        onViewportChange={value => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('week', value); return next; })} />
      <QuickCaptureBar active={active} onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture}
        onOpenBarcode={openBarcode} onAddTo={setAddingTo} busy={nutrition.busy} date={date} />
      {undoDelete ? <div className="health-pending" role="status">
        <span>{undoDelete.label} deleted.</span>
        <Button size="compact-xs" loading={undoBusy} onClick={async () => {
          if (undoPending.current) return;
          undoPending.current = true; setUndoBusy(true);
          try {
            await DaylightAPI('api/v1/health/nutrition/restore', { entryIds: undoDelete.entryIds }, 'POST');
            setUndoDelete(null); day.reload();
          } catch (err) { setCaptureNotice(err.message); }
          finally { undoPending.current = false; setUndoBusy(false); }
        }}>Undo</Button>
        <Button size="compact-xs" variant="subtle" disabled={undoBusy} onClick={() => setUndoDelete(null)}>Dismiss</Button>
      </div> : null}
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {pendingReview.error ? <ErrorState error={pendingReview.error} onRetry={pendingReview.reload} label="Food review unavailable" /> : null}
      {observations.error ? <ErrorState error={observations.error} onRetry={observations.reload} label="Measurements unavailable" /> : null}
      {captureNotice ? (
        <div className="health-pending" role="status">
          <p className="health-pending__line">{captureNotice}</p>
          <div className="health-pending__actions">
            {captureRetry ? (
              <Button size="xs" loading={nutrition.busy} disabled={nutrition.busy}
                onClick={retryVoiceCapture}>Try again</Button>
            ) : null}
            <Button size="xs" variant="subtle"
              onClick={() => { setCaptureNotice(null); setCaptureRetry(null); }}>Dismiss</Button>
          </div>
        </div>
      ) : null}
      <NeedsReviewSection pending={pendingLogs} onChanged={day.reload} />
      <CleanupQuestions active={active} onChanged={day.reload} />
      <ObservationsSection observations={unmatched} onChanged={() => observations.reload()} />
      <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
        active={active}
        exerciseAvailable={Boolean(day.budget)}
        coldLoading={coldLoading} capturePendingBuckets={[...capturePending.values()].filter(pending => pending.date === date).map(pending => pending.bucket)}
        onAddTo={setAddingTo} onRowTap={setEditingRow} onConfirm={day.reload} addingTo={addingTo}
        bucketHeaderAction={bucketHeaderAction}
        onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture}
        onOpenBarcode={openBarcode} captureBusy={nutrition.busy}
        measuredByUuid={measuredByUuid}
        addSlot={addingTo ? (
          <div className="health-meal__adding">
          <QuickCaptureBar active={active} bucketOverride={addingTo} date={date} busy={nutrition.busy}
            onVoiceCapture={onVoiceCapture} onPhotoCapture={onPhotoCapture} onOpenBarcode={openBarcode} onAddTo={setAddingTo} />
          <AddCombobox bucketId={addingTo} date={date}
            onDone={() => { setAddingTo(null); day.reload(); }}
            onCancel={() => setAddingTo(null)}
            onManageFoods={() => setManageFoods(true)}
            onMeals={() => { setFocusTemplateId(null); setTemplatesFor(addingTo); }}
            onTemplate={(entry) => { setFocusTemplateId(entry.id); setTemplatesFor(addingTo); }} />
          </div>
        ) : null} />
      <MacroFooter items={day.items} coachLine={coachLine} onCoachTap={onCoachTap} />
      <BarcodeCapture open={active && captureMode === 'barcode'} busy={nutrition.busy} bucket={barcodeTargetBucket}
        onClose={() => { setCaptureMode(null); setBarcodeTargetBucket(null); }}
        onDecode={async (upc, bucket) => {
          const result = await submitWithPending('barcode', upc, { bucket, date: barcodeDate });
          if (result?.unknownUpc) { setCaptureMode(null); setUnknownUpc(result.upc); return; }
          setCaptureMode(null);
          if (result?.moved) setCaptureNotice(`Moved to ${bucketLabel(result.mealTime)}`);
          day.reload();
        }} />
      <CustomFoodSheet upc={unknownUpc} open={active && Boolean(unknownUpc)}
        bucketId={barcodeTargetBucket} date={barcodeDate}
        onClose={() => setUnknownUpc(null)}
        onCreated={() => { setUnknownUpc(null); day.reload(); }} />
      <EntryEditor row={editingRow} open={active && Boolean(editingRow)}
        onClose={() => setEditingRow(null)} onChanged={day.reload}
        onDeleted={setUndoDelete}
        onCoach={() => { onCoachTap(editingRow); setEditingRow(null); }}
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
      <FoodCatalogManager open={active && manageFoods} onClose={() => setManageFoods(false)} onChanged={day.reload} />
      <TemplatePicker open={active && Boolean(templatesFor)} bucketId={templatesFor} date={date} focusTemplateId={focusTemplateId}
        onLogged={() => { setTemplatesFor(null); setFocusTemplateId(null); setAddingTo(null); day.reload(); }}
        onClose={() => { setTemplatesFor(null); setFocusTemplateId(null); }} />
    </div>
  );
}
export default TodayView;
