import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PortionContext, usePortionDraft } from './usePortionDraft.js';
import { nutrientSummary } from '@shared-contracts/nutrition/countedRows.mjs';
import { useSearchParams } from 'react-router-dom';
import { isISODate } from '@shared-contracts/health/isoDate.mjs';
import { ActionIcon, Button, Menu } from '@mantine/core';
import { ErrorState } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useHealthDay } from './useHealthDay.js';
import { pendingReviewPath, observationsPath } from '../healthResources.js';
import { useHealthDayPrefetch } from './useHealthDayPrefetch.js';
import { useAddedRowHighlight } from './addFlow.js';
import { EquationStrip } from './EquationStrip.jsx';
import { WeekStrip, addDays, weekEnd } from './WeekStrip.jsx';
import { MacroBarRow } from './MacroBarRow.jsx';
import { WeightChip } from './WeightChip.jsx';
import { MonthBlock } from './MonthBlock.jsx';
import { useBudgetRange } from './useBudgetRange.js';
import { useIsWideViewport } from './layout.js';
import { LogTable } from './LogTable.jsx';
import { MealAddRow } from './MealAddRow.jsx';
import { useMealMoves, mealEntries } from './mealDrag.jsx';
import { NeedsReviewSection } from './NeedsReviewSection.jsx';
import { DayCloseRow } from './DayCloseRow.jsx';
import { FollowUpTray } from './FollowUpTray.jsx';
import { EntryEditor } from './EntryEditor.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { TodayToasts } from './TodayToasts.jsx';
import { draftHasAlert, dayHasEntry } from './PortionDraftAlert.jsx';
import { deleteEntry, deleteConfirmBody, entryLabel, entryId } from './entryCommands.js';
import { TemplatePicker } from './TemplatePicker.jsx';
import { FoodCatalogManager } from './FoodCatalogManager.jsx';
import { localTodayISO as todayISO, currentMealBucketId, bucketLabel, BUCKETS } from './mealBuckets.js';
import { useNutritionInput } from '../capture/useNutritionInput.js';
import { BarcodeCapture } from '../capture/BarcodeCapture.jsx';
import { CustomFoodSheet } from '../capture/CustomFoodSheet.jsx';

const logger = createAppLogger('health').child('today');
const IntakeBurnChart = lazy(() => import('../progress/IntakeBurnChart.jsx').then(module => ({ default: module.IntakeBurnChart })));

export function TodayView({ active = true, sidebarTarget, onSetupGoals, onCoachTap }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const date = isISODate(dateParam) && dateParam <= todayISO() ? dateParam : todayISO();
  const setDate = (value) => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('date', value); next.set('week', weekEnd(value)); return next; });
  const weekParam = searchParams.get('week');
  const viewportEnd = isISODate(weekParam) && weekParam <= weekEnd(todayISO()) ? weekEnd(weekParam) : weekEnd(date);
  const day = useHealthDay(date, { enabled: active });
  // Drag-to-meal moves wear their new meal from the drop until the day
  // reloads with them (mealDrag.jsx), so the portion overlay reads that view.
  const moves = useMealMoves(day);
  const movedDay = useMemo(() => ({ ...day, items: moves.items }), [day, moves.items]);
  const preview = usePortionDraft(movedDay, date);
  // Rows just added from an add row, briefly highlighted once on screen.
  const justAdded = useAddedRowHighlight(day.items);
  const addedIds = useMemo(() => (moves.recentIds.size ? new Set([...justAdded, ...moves.recentIds]) : justAdded), [justAdded, moves.recentIds]);
  // Warm ±7 days and each meal's shortlist once the viewed day is on screen.
  useHealthDayPrefetch(date, { enabled: active, ready: !day.loading });
  const [mealUndo, setMealUndo] = useState(null);
  // A failed voice send whose mic unmounted (the day changed): { run, label, busy, error }.
  const [orphanRetry, setOrphanRetry] = useState(null);
  const keepOrphanedRecording = (run, { mealLabel, date: recordedOn }) => setOrphanRetry({ run, label: recordedOn && recordedOn !== todayISO() ? `${mealLabel} recording from ${recordedOn}` : `${mealLabel} recording`, busy: false, error: null });
  const retryOrphanedRecording = async () => {
    if (!orphanRetry || orphanRetry.busy) return;
    setOrphanRetry(previous => ({ ...previous, busy: true, error: null }));
    try { await orphanRetry.run(); setOrphanRetry(null); logger.info('voice.retry_handoff.sent'); }
    catch (err) { setOrphanRetry(previous => previous && ({ ...previous, busy: false, error: err?.message || 'Still could not send it.' })); }
  };
  const mealUndoOperation = useRef(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet
  const [captureMode, setCaptureMode] = useState(null); // 'barcode' | null
  // bucketId | null — which meal's add-row barcode button opened the
  // sheet (null = an unlabeled launch). Forwarded to BarcodeCapture so it
  // can hand the same id back on decode.
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
  // The row awaiting a yes, plus the in-flight/error state of that yes. Held by
  // the VIEW so one dialog serves every row and the edit sheet alike — see
  // ConfirmDialog on why this is not per-row state.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const confirmDelete = async () => {
    if (deleteBusy || !pendingDelete) return;
    setDeleteBusy(true); setDeleteError(null);
    try {
      const removed = await deleteEntry(pendingDelete);
      logger.info('entry.delete', { uuid: pendingDelete.uuid || pendingDelete.id, count: removed.entryIds.length });
      setPendingDelete(null); setUndoDelete(removed); day.reload();
    } catch (err) {
      // The dialog STAYS OPEN on failure. Closing it would report a delete that
      // did not happen, and the row is still there to prove otherwise.
      logger.warn('entry.delete_failed', { uuid: pendingDelete.uuid || pendingDelete.id, error: err.message });
      setDeleteError(err.message || 'Could not delete. Try again when connected.');
    } finally { setDeleteBusy(false); }
  };
  const [undoBusy, setUndoBusy] = useState(false);
  const undoPending = useRef(false);
  const [barcodeDate, setBarcodeDate] = useState(date);
  // { audioRef | content, bucket, date, selectedIds } | null — a voice capture whose transcription failed on
  // the network. The recording is on the server, so the notice can offer a
  // retry that re-uses it rather than asking for it again. Departed controls
  // also retain the original content here if its upload failed.
  const [captureRetry, setCaptureRetry] = useState(null);
  // Keep choices with the original meal even when transcription is retried
  // outside its microphone control, or the viewed date changes.
  const [mealClarifications, setMealClarifications] = useState(new Map());
  const clearMealClarification = key => setMealClarifications(previous => { const next = new Map(previous); next.delete(key); return next; });
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
  const pendingReview = useApiResource(pendingReviewPath(date),
    { deps: [date], enabled: active, label: 'pending-review', logger, swr: true });
  const pendingLogs = pendingReview.data?.pending || [];
  // The DURABLE kitchen-scale ledger for this date (Task 5.4). Distinct from
  // `pendingReview` above, which is about NutriLogs awaiting Accept/Discard:
  // these are the raw signals underneath — a settled weight, a scanned
  // density/tare — which exist whether or not any log was ever created from
  // them. `swr:true` for the same reason the day itself uses it: a reload
  // after a dismiss/pair revalidates quietly instead of blanking the section.
  const observations = useApiResource(observationsPath(date),
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
  const handleCaptureResult = (result, bucket = null, targetDate = date, context = {}) => {
    // Offer the retry BEFORE the message is rendered, so the sentence that
    // says the recording is saved arrives with the button that uses it.
    setCaptureRetry(result?.transcribeFailed && result?.audioRef
      ? { audioRef: result.audioRef, bucket: bucket || currentMealBucketId(), date: targetDate, selectedIds: [...(context.selectedIds || [])] }
      : null);
    const clarificationKey = `${targetDate}:${bucket || currentMealBucketId()}`;
    if (result?.clarification) {
      setMealClarifications(previous => new Map(previous).set(clarificationKey, { ...result.clarification, instructionText: result.instructionText || result.clarification.instructionText, selectedIds: [...(context.selectedIds || [])] }));
    } else { clearMealClarification(clarificationKey); }
    if (result?.committed) {
      day.reload(); pendingReview.reload();
      setCaptureNotice(result?.moved ? `Moved to ${bucketLabel(result.mealTime)}` : null);
      if (result.undoToken) { setMealUndo({token:result.undoToken,label:'Meal updated'}); mealUndoOperation.current=null; }
      return;
    }
    if (result?.clarification) { setCaptureNotice(null); return; }
    if (result?.moved) {
      setCaptureNotice(`Moved to ${bucketLabel(result.mealTime)}`);
      day.reload();
      return;
    }
    const messages = result?.messages || [];
    const hasChoices = messages.some((m) => (m.choices || []).flat().length > 0);
    if (!hasChoices) {
      const text = result?.responseText || messages.at(-1)?.text;
      if (text) setCaptureNotice(text);
      return;
    }
    day.reload();
  };

  // Wraps any capture submit (photo/voice/barcode) with the in-place pending
  // placeholder: mark the bucket a new entry would land in NOW as pending
  // before the request goes out, always clear it afterward regardless of
  // outcome — a failed capture must not leave a stuck "Analyzing…" row.
  // `bucket` is the explicit per-meal target (from a meal's add-row capture
  // button); when absent we
  // fall back to the same currentMealBucketId() guess as before — this is
  // ONLY where the placeholder shows, never the backend's actual
  // resolution.
  const submitWithPending = async (type, content, { bucket, audioRef, date: targetDate = date, selectedIds, clarification } = {}) => {
    const bucketId = bucket || currentMealBucketId();
    const pendingId = crypto.randomUUID();
    setCapturePending(previous => new Map(previous).set(pendingId, { id:pendingId, bucket: bucketId, date: targetDate, startedAt:Date.now() }));
    try {
      // THE VIEWED DAY TRAVELS WITH THE CAPTURE. Without it the row is dated by
      // the server's clock, so food entered while looking at yesterday appeared
      // on today — the defect this closes. Only the LOGICAL date follows the
      // view; createdAt/settledAt stay real wall-clock instants.
      return await nutrition.submit(type, content, { bucket, date: targetDate, audioRef, selectedIds, clarification });
    } catch (err) {
      setCaptureNotice(err?.message || 'Capture interrupted. Retry to check its result.');
      throw err;
    } finally {
      setCapturePending(previous => { const next = new Map(previous); next.delete(pendingId); return next; });
    }
  };

  // A typed sentence in a meal's add row: the same in-place pending row as a
  // capture, labelled with the text, released by the add row once the parsed
  // rows are on the day (or the parse failed).
  const beginSentencePending = (bucket, text) => {
    const pendingId = crypto.randomUUID();
    setCapturePending(previous => new Map(previous).set(pendingId, { id: pendingId, bucket, date, startedAt: Date.now(), text }));
    return () => setCapturePending(previous => { if (!previous.has(pendingId)) return previous; const next = new Map(previous); next.delete(pendingId); return next; });
  };

  // Shared by every meal's add-row Voice/Photo trigger — VoiceCapture/
  // PhotoCapture forward `(dataUrl, bucket)`, `bucket` being that meal's id.
  const handleVoiceOrPhotoCapture = async (type, dataUrl, bucket, context = {}) => {
    try {
      const result = await submitWithPending(type, dataUrl, { bucket, ...context });
      handleCaptureResult(result, bucket, context.date || date, context);
      return result;
    } catch (err) {
      // A date change removes the microphone's local retry owner. Keep the
      // recording here so a failed upload can resend exactly the same intent.
      if (type === 'voice' && (context.departed || context.isDeparted?.())) {
        setCaptureRetry({ content: dataUrl, bucket, date: context.date || date, selectedIds: [...(context.selectedIds || [])] });
      }
      throw err;
    }
  };

  // A transcription that failed on the network left the RECORDING on the
  // server (VoiceMemoStore). Retrying re-sends its ref, so the person never
  // has to say it again — which is the only thing that makes persisting it
  // worth doing. A ref the server can no longer find comes back as a 404 with
  // a sentence, and the retry affordance retires with it.
  const retryVoiceCapture = async () => {
    if (!captureRetry) return;
    const { audioRef, content = null, bucket, date: targetDate, selectedIds } = captureRetry;
    setCaptureNotice(null);
    try {
      handleCaptureResult(await submitWithPending('voice', content, { bucket, audioRef, date: targetDate, selectedIds }), bucket, targetDate, { selectedIds });
    } catch (err) {
      logger.error('capture.retry.failed', { audioRef, error: err?.message });
      setCaptureNotice('Retry failed. The saved recording is still selected; try again when connected.');
    }
  };
  const onVoiceCapture = (dataUrl, bucket, context) => handleVoiceOrPhotoCapture('voice', dataUrl, bucket, context);
  const onTextCapture = (text,bucket,context) => handleVoiceOrPhotoCapture('text',text,bucket,context);
  const onPhotoCapture = (dataUrl, bucket) => handleVoiceOrPhotoCapture('image', dataUrl, bucket);

  // Opens the barcode sheet, pre-targeted at the meal whose add row asked.
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
        <Menu.Divider />
        <Menu.Label>Move all to</Menu.Label>
        {BUCKETS.filter(bucket => bucket.id !== bucketId).map(bucket => <Menu.Item key={bucket.id}
          aria-label={`Move all of ${label} to ${bucket.label}`} onClick={() => moves.moveMeal(mealEntries(rows), bucket.id, bucketId)}>{bucket.label}</Menu.Item>)}
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

  const undoMealChange = async () => {
    if (undoPending.current || !mealUndo) return;
    undoPending.current = true; setUndoBusy(true);
    mealUndoOperation.current ??= crypto.randomUUID();
    try { await DaylightAPI('api/v1/health/nutrition/meal-undo', { undoToken: mealUndo.token, operationId: mealUndoOperation.current }, 'POST'); setMealUndo(null); day.reload(); }
    catch (err) { setCaptureNotice(err.message || 'Undo failed. Try again.'); }
    finally { undoPending.current = false; setUndoBusy(false); }
  };
  const undoDeletedEntry = async () => {
    if (undoPending.current || !undoDelete) return;
    undoPending.current = true; setUndoBusy(true);
    try {
      await DaylightAPI('api/v1/health/nutrition/restore', { entryIds: undoDelete.entryIds }, 'POST');
      setUndoDelete(null); day.reload();
    } catch (err) { setCaptureNotice(err.message); }
    finally { undoPending.current = false; setUndoBusy(false); }
  };
  // A portion edit's error is shown on its own row (EntryRow). The one case
  // with no row to sit on — the entry left the day — falls back to a toast.
  const portionControl = { ...preview.control, reloadDay: day.reload };
  const strandedPortion = !coldLoading && draftHasAlert(preview.control.draft) && !dayHasEntry(movedDay.items, entryId(preview.control.draft.row));

  const history = <>
    <WeekStrip enabled={active} date={date} today={todayISO()} onDateChange={setDate} viewportEnd={viewportEnd}
      onViewportChange={value => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('week', value); return next; })} />
    {active ? <WeightChip asOf={date} /> : null}
    {wideViewport ? <MonthBlock days={monthRange.days} loading={monthRange.loading} /> : null}
    {wideViewport ? <Suspense fallback={null}><IntakeBurnChart days={monthRange.days} loading={monthRange.loading} /></Suspense> : null}
  </>;

  return (
    <PortionContext.Provider value={portionControl}><div className="health-today">
      <EquationStrip budget={preview.budget} budgetError={day.budgetError} goals={preview.budget?.goals}
        macroCoverage={nutrientSummary(preview.items)} date={date} today={todayISO()}
        onDateChange={setDate} onSetupGoals={onSetupGoals} />
      {/* Watch-micro bars sit directly under the summary (F4.1); the macros
          moved into the summary itself. They read the SAME day sums the budget
          does — BudgetService computes both over one fold — so the bars and the
          kcal number can never disagree. */}
      <MacroBarRow macros={preview.budget?.macros} goals={preview.budget?.goals}
        macroCoverage={nutrientSummary(preview.items)} microCoverage={preview.budget?.microCoverage}
        showIntake={false} showMacros={false} />
      {/* Follow-ups arrive on their own schedule (a 15 s poll, a scale), so they
          get a fixed one-line slot rather than a banner that moves the day. */}
      <FollowUpTray active={active} observations={unmatched} onObservationsChanged={() => observations.reload()} onChanged={day.reload} />
      {wideViewport && sidebarTarget ? createPortal(history, sidebarTarget) : null}
      <TodayToasts captureNotice={captureNotice} captureRetry={captureRetry} retryBusy={nutrition.busy}
        onRetryCapture={retryVoiceCapture} onDismissCapture={() => { setCaptureNotice(null); setCaptureRetry(null); }}
        orphanRetry={orphanRetry} onRetryOrphan={retryOrphanedRecording} onDismissOrphan={() => setOrphanRetry(null)}
        moves={moves} mealUndo={mealUndo} onUndoMeal={undoMealChange} onDismissMealUndo={() => setMealUndo(null)}
        undoDelete={undoDelete} onUndoDelete={undoDeletedEntry} onDismissUndoDelete={() => setUndoDelete(null)} undoBusy={undoBusy}
        strandedPortion={strandedPortion ? portionControl : null} />
      <ConfirmDialog open={Boolean(pendingDelete)} title={pendingDelete ? `Delete ${entryLabel(pendingDelete)}?` : ''}
        body={pendingDelete ? deleteConfirmBody(pendingDelete) : ''} busy={deleteBusy} error={deleteError}
        onConfirm={confirmDelete} onCancel={() => { setPendingDelete(null); setDeleteError(null); }} />
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {pendingReview.error ? <ErrorState error={pendingReview.error} onRetry={pendingReview.reload} label="Food review unavailable" /> : null}
      {observations.error ? <ErrorState error={observations.error} onRetry={observations.reload} label="Measurements unavailable" /> : null}
      <LogTable clarifications={mealClarifications} onClearClarification={clearMealClarification} byBucket={preview.byBucket} date={date} sessions={preview.budget?.sessions || []}
        exerciseAvailable={Boolean(day.budget)}
        coldLoading={coldLoading} capturePendingBuckets={[...capturePending.values()].filter(pending => pending.date === date).map(pending => pending.bucket)}
        onRowTap={setEditingRow} onConfirm={day.reload} onRequestDelete={row => { setDeleteError(null); setPendingDelete(row); }}
        bucketHeaderAction={bucketHeaderAction}
        onVoiceCapture={onVoiceCapture} onTextCapture={onTextCapture}
        onMealChanged={result=>handleCaptureResult(result)} captureTasks={[...capturePending.values()]}
        measuredByUuid={measuredByUuid} addedIds={addedIds} onMoveEntry={moves.move} onMoveMeal={moves.moveMeal}
        renderAddRow={(bucket, label, meal) => <MealAddRow bucket={bucket} label={label} date={date} active={active}
          onVoiceCapture={meal?.onVoiceCapture} selectedCount={meal?.selectedIds?.length || 0} busy={nutrition.busy} onOrphanedRetry={keepOrphanedRecording}
          onAdded={() => day.reload()} onSentencePending={text => beginSentencePending(bucket, text)} onPhotoCapture={onPhotoCapture} onOpenBarcode={openBarcode}
          onOpenTemplates={(target, templateId) => { setFocusTemplateId(templateId); setTemplatesFor(target); }}
          onManageFoods={() => setManageFoods(true)} />} />
      <NeedsReviewSection pending={pendingLogs} onChanged={day.reload} />
      {!coldLoading ? <DayCloseRow date={date} dayStatus={day.dayStatus} items={day.items} onChanged={day.reload} /> : null}
      {!wideViewport || !sidebarTarget ? <details className="health-history"><summary>Week &amp; weight history</summary>{history}</details> : null}
      {coachLine ? <Button variant="subtle" onClick={() => onCoachTap()}>{coachLine}</Button> : null}
      <BarcodeCapture open={active && captureMode === 'barcode'} busy={nutrition.busy} bucket={barcodeTargetBucket}
        onClose={() => { setCaptureMode(null); setBarcodeTargetBucket(null); }}
        onDecode={async (upc, bucket) => {
          const result = await submitWithPending('barcode', upc, { bucket, date: barcodeDate });
          if (result?.unknownUpc) { setCaptureMode(null); setUnknownUpc(result.upc); return; }
          setCaptureMode(null);
          // Not a food barcode (bad check digit, an ISBN): nothing was logged,
          // and the server sends the one sentence that says why.
          if (result?.outcome === 'rejected-barcode') {
            logger.info('barcode.rejected', { reason: result.rejected ?? null });
            setCaptureNotice(result.message || "That isn't a food barcode.");
            return;
          }
          // Saved, but no calories were found: it waits in Needs Review
          // instead of adding an unknown to the day's totals.
          if (result?.outcome === 'needs-review') {
            logger.info('barcode.needs-review', { logId: result.logId ?? null, quarantined: result.quarantined === true });
            setCaptureNotice(result.message || 'Needs review — no calories found');
            pendingReview.reload();
            return;
          }
          // No calories on the label: logged anyway as an unconfirmed AI
          // estimate of one typical serving. Say so — it is a guess to check.
          if (result?.aiEstimate) {
            logger.info('barcode.ai-estimate', { logId: result.logId ?? null });
            setCaptureNotice('No calories on the label — estimated for one serving. Check the row.');
          } else if (result?.moved) setCaptureNotice(`Moved to ${bucketLabel(result.mealTime)}`);
          day.reload();
        }} />
      <CustomFoodSheet upc={unknownUpc} open={active && Boolean(unknownUpc)}
        bucketId={barcodeTargetBucket} date={barcodeDate}
        onClose={() => setUnknownUpc(null)}
        onCreated={() => { setUnknownUpc(null); day.reload(); }} />
      <EntryEditor row={editingRow} open={active && Boolean(editingRow)}
        onClose={() => setEditingRow(null)} onChanged={day.reload}
        onRequestDelete={row => { setDeleteError(null); setEditingRow(null); setPendingDelete(row); }}
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
        onLogged={() => { setTemplatesFor(null); setFocusTemplateId(null); day.reload(); }}
        onClose={() => { setTemplatesFor(null); setFocusTemplateId(null); }} />
    </div></PortionContext.Provider>
  );
}
export default TodayView;
