import { useFoodMutation } from "../operations/useFoodMutation.js";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PortionContext, usePortionDraft } from "./usePortionDraft.js";
import { nutrientSummary } from "../../portable/contracts/nutrition/countedRows.mjs";
import { SHARED_LOG_IDS } from "../../portable/contracts/nutrition/sharedLogIds.mjs";
import { useSearchParams } from 'react-router-dom';
import { isISODate } from "../../portable/contracts/health/isoDate.mjs";
import { ActionIcon, Button, Menu } from '@mantine/core';
import { ErrorState } from '@/lib/ui';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { useHealthDay } from "./useHealthDay.js";
import { pendingReviewPath, observationsPath, healthDayPath } from "../healthResources.js";
import { useHealthDayPrefetch } from "./useHealthDayPrefetch.js";
import { useAddedRowHighlight } from "./addFlow.js";
import { EquationStrip } from "./EquationStrip.jsx";
import { WeekStrip, addDays, weekEnd } from "./WeekStrip.jsx";
import { MacroBarRow } from "./MacroBarRow.jsx";
import { WeightChip } from "./WeightChip.jsx";
import { MonthBlock } from "./MonthBlock.jsx";
import { useBudgetRange } from "./useBudgetRange.js";
import { useAfterFirstPaint } from "./useAfterFirstPaint.js";
import { useIsWideViewport } from "./layout.js";
import { LogTable } from "./LogTable.jsx";
import { MealAddRow } from "./MealAddRow.jsx";
import { DayInputBar } from "./DayInputBar.jsx";
import { useMealMoves, mealEntries, dayEntries, MoveResult, isDefiniteRefusal, refusalReason, unconfirmedMoveText } from "./mealDrag.jsx";
import { dayLabel } from "./moveDays.js";
import { MoveDayItems, MENU_CLASSES } from "./MoveDayControl.jsx";
import { NeedsReviewSection } from "./NeedsReviewSection.jsx";
import { DayClosePill } from "./DayClosePill.jsx";
import { FollowUpTray } from "./FollowUpTray.jsx";
import { EntryEditor } from "./EntryEditor.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { TodayToasts } from "./TodayToasts.jsx";
import { draftHasAlert, dayHasEntry } from "./PortionDraftAlert.jsx";
import { deleteEntry, deleteConfirmBody, entryLabel, entryId } from "./entryCommands.js";
import { TemplatePicker } from "./TemplatePicker.jsx";
import { FoodCatalogManager } from "./FoodCatalogManager.jsx";
import { localTodayISO as todayISO, currentMealBucketId, bucketLabel, BUCKETS } from "./mealBuckets.js";
import { useNutritionInput } from "../capture/useNutritionInput.js";
import { BarcodeCapture } from "../capture/BarcodeCapture.jsx";
import { BarcodeOperationStatus } from '../operations/BarcodeOperationStatus.jsx';
import { useHealthOperations } from '../operations/HealthOperationsProvider.jsx';
import { CustomFoodSheet } from "../capture/CustomFoodSheet.jsx";

const logger = createAppLogger('health').child('today');
const IntakeBurnChart = lazy(() => import("../progress/IntakeBurnChart.jsx").then(module => ({ default: module.IntakeBurnChart })));

/**
 * What a capture added, as it stands on a day now. A log ID shared with earlier
 * foods proves nothing, so only the IDs the capture returned count then. A dish
 * moves only when every part is from this capture, because the move carries them
 * all; `blocked` is what was captured into a dish holding other food.
 */
function captureEntries(items, { logId, ids = [] }) {
  const exact = new Set(ids);
  const ownLogId = SHARED_LOG_IDS.has(logId) ? null : logId;
  const captured = row => exact.has(String(entryId(row))) || Boolean(ownLogId && row.logId === ownLogId);
  const entries = [], blocked = [];
  for (const entry of mealEntries(items)) {
    const parts = entry.children || [];
    if (parts.length ? parts.every(captured) : captured(entry)) entries.push(entry);
    else {
      const held = parts.filter(captured);
      blocked.push(...(held.length || !captured(entry) ? held : [entry]));
    }
  }
  return { entries, blocked };
}

// The capture toasts: at most one with an Undo, plus day offers without one. Offers
// stay until used or dismissed, so only the newest few are kept on a phone's screen.
const MAX_DAY_OFFERS = 2;
const NO_CAPTURE_TOASTS = { undo: null, offers: [] };
const sameFood = (a, b) => Boolean(a && b) && (a.ids.some(id => b.ids.includes(id))
  || (a.logId === b.logId && Boolean(a.logId) && !SHARED_LOG_IDS.has(a.logId)));
// The day offer outlives its toast's Undo. A failed Undo is then the page's to report,
// and `replacedUndo` lets the offer retire if that Undo still finishes.
const withOffer = (offers, shown) => [{ ...shown, token: null, failure: null, replacedUndo: shown.token },
  ...offers.filter(other => !sameFood(other.offer, shown.offer))].slice(0, MAX_DAY_OFFERS);
/** A new result. An Undo it replaces leaves its day offer behind, unless it is for the same food. */
function announceCapture(state, undo) {
  if (!undo.token) {
    if (!undo.offer || sameFood(state.undo?.offer, undo.offer)) return state;
    return { ...state, offers: withOffer(state.offers, undo) };
  }
  const kept = state.undo?.offer && !sameFood(state.undo.offer, undo.offer) ? withOffer(state.offers, state.undo) : state.offers;
  return { undo, offers: undo.offer ? kept.filter(shown => !sameFood(shown.offer, undo.offer)) : kept };
}
/** A newer action took over the one Undo slot. The food can still be moved. */
const supersedeCaptureUndo = state => ({ undo: null, offers: state.undo?.offer ? withOffer(state.offers, state.undo) : state.offers });
/** An Undo finished, by any route. The food it covers may be gone, so nothing offers it any more. */
const afterMealUndo = (state, token) => ({ undo: state.undo?.token === token ? null : state.undo,
  offers: state.offers.filter(shown => shown.replacedUndo !== token) });
const capturePlace = (what, date, mealId) => `Added ${what} to ${dayLabel(date, todayISO())}${mealId ? `, ${bucketLabel(mealId)}` : ''}`;
const updateOffer = (state, offer, change) => {
  const update = shown => (shown?.offer === offer ? change(shown) : shown);
  return { undo: update(state.undo), offers: state.offers.map(update) };
};
/**
 * A move finished, by any route. Food sent to another day takes its toast along.
 * Food sent to another meal can still be on the wrong day, so its toast stays and
 * stops naming a meal: some or all of it has left the one it named.
 */
function afterCompletedMove(state, { ids, logIds, toDate }) {
  const touched = shown => Boolean(shown?.offer) && (shown.offer.ids.some(id => ids.includes(id))
    || (logIds.includes(shown.offer.logId) && !SHARED_LOG_IDS.has(shown.offer.logId)));
  if (toDate) return { undo: touched(state.undo) ? null : state.undo, offers: state.offers.filter(shown => !touched(shown)) };
  const relabel = shown => (touched(shown) ? { ...shown, label: capturePlace(shown.offer.what, shown.offer.date) } : shown);
  return { undo: state.undo && relabel(state.undo), offers: state.offers.map(relabel) };
}
const stayedInDish = rows => `${rows.length === 1 ? entryLabel(rows[0]) : `${rows.length} foods`} ${rows.length === 1 ? 'is' : 'are'} part of a dish and can't move alone`;

export function TodayView({ active = true, sidebarTarget, followUpTarget = null, onSetupGoals, onCoachTap }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const date = isISODate(dateParam) && dateParam <= todayISO() ? dateParam : todayISO();
  const setDate = (value) => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('date', value); next.set('week', weekEnd(value)); return next; });
  const weekParam = searchParams.get('week');
  const viewportEnd = isISODate(weekParam) && weekParam <= weekEnd(todayISO()) ? weekEnd(weekParam) : weekEnd(date);
  const day = useHealthDay(date, { enabled: active });
  const foodAPI = useFoodMutation(day.items);
  // Drag-to-meal moves wear their new meal from the drop until the day
  // reloads with them (mealDrag.jsx), so the portion overlay reads that view.
  const moves = useMealMoves(day);
  const movedDay = useMemo(() => ({ ...day, items: moves.items }), [day, moves.items]);
  const preview = usePortionDraft(movedDay, date);
  const completedMove = moves.undo?.operationId;
  // Rows just added from an add row, briefly highlighted once on screen.
  const justAdded = useAddedRowHighlight(day.items);
  const addedIds = useMemo(() => (moves.recentIds.size ? new Set([...justAdded, ...moves.recentIds]) : justAdded), [justAdded, moves.recentIds]);
  // The day on screen goes first. Everything it does not need — neighbouring
  // days, the coach line, the sidebar's month — waits until the server has
  // answered for the day and the browser has had an idle moment, so a slow
  // request never holds the page or a connection the day is waiting on.
  const settled = useAfterFirstPaint(!day.loading && !day.revalidating);
  // Warm ±7 days and each meal's shortlist once the viewed day is on screen.
  useHealthDayPrefetch(date, { enabled: active, ready: settled && !day.loading });
  const [captureToasts, setCaptureToasts] = useState(NO_CAPTURE_TOASTS);
  const mealUndo = captureToasts.undo;
  const clearMealUndo = () => setCaptureToasts(state => ({ ...state, undo: null }));
  useEffect(() => {
    if (moves.undo?.moved) setCaptureToasts(state => afterCompletedMove(state, moves.undo.moved));
    // One pass per finished move; the object itself is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedMove]);
  // A failed voice send whose mic unmounted (the day changed): { run, label, busy, error }.
  const [orphanRetry, setOrphanRetry] = useState(null);
  const keepOrphanedRecording = (run, { mealLabel, date: recordedOn }) => setOrphanRetry({ run, label: recordedOn && recordedOn !== todayISO() ? `${mealLabel} recording from ${recordedOn}` : `${mealLabel} recording`, busy: false, error: null });
  const retryOrphanedRecording = async () => {
    if (!orphanRetry || orphanRetry.busy) return;
    setOrphanRetry(previous => ({ ...previous, busy: true, error: null }));
    try { await orphanRetry.run(); setOrphanRetry(null); logger.info('voice.retry_handoff.sent'); }
    catch (err) { setOrphanRetry(previous => previous && ({ ...previous, busy: false, error: err?.message || 'Still could not send it.' })); }
  };
  const mealUndoOperations = useRef(new Map());
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet
  const healthOperations = useHealthOperations();
  const [selectedCapture, setSelectedCapture] = useState(null);
  const captureStatusOpen = searchParams.get('capture') === 'status';
  const showHealthCaptureStatus = () => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('capture', 'status');
      return next;
    }, { replace: true });
  };
  const closeHealthCaptureStatus = () => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('capture');
      return next;
    }, { replace: true });
  };
  const mealLog = searchParams.get('mealLog');
  useEffect(() => {
    if (!active || !mealLog || day.loading || day.revalidating || day.error || !day.authoritative) return;
    const row = day.items.find(item => (item.logId || item.logUuid) === mealLog);
    if (row) setEditingRow(row);
    else setCaptureNotice('This saved meal was not found on this day.');
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('mealLog');
      return next;
    }, { replace: true });
  }, [active, day.items, day.loading, day.revalidating, day.error, day.authoritative, mealLog, setSearchParams]);
  useEffect(() => {
    if (!selectedCapture || selectedCapture.date !== date) return;
    const row = day.items.find(item => selectedCapture.entryIds.includes(String(entryId(item))));
    if (row) {
      setEditingRow(row);
      setSelectedCapture(null);
    }
  }, [date, day.items, selectedCapture]);
  const [captureMode, setCaptureMode] = useState(() => searchParams.get('capture') === 'barcode' ? 'barcode' : null);
  const barcodeShortcut = useRef(searchParams.get('capture') === 'barcode');
  useEffect(() => {
    if (!active) {
      setCaptureMode(null);
      barcodeShortcut.current = false;
    }
  }, [active]);
  // The meal launching the scanner supplies its default review target.
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
  const [dayNotice, setDayNotice] = useState(null); // string | null — the day input's reply when it has no Undo
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
      const removed = await deleteEntry(pendingDelete, foodAPI);
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
  // The unknown-outcome move the day sheet is showing, which it reports itself.
  const [sheetMove, setSheetMove] = useState(null);
  // The move the sheet was offering to retry when it closed. Its toast takes focus.
  const [handedBackMove, setHandedBackMove] = useState(null);
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
  // needs it. The hook would share one in-flight request between two widgets
  // anyway; owning it here keeps one `enabled` gate and one loading state.
  const monthEnd = date < todayISO() ? date : todayISO();
  const monthRange = useBudgetRange(addDays(monthEnd, -29), monthEnd, { enabled: active && wideViewport && settled });
  // Waiting its turn with nothing cached reads as loading, not as an empty month.
  const monthLoading = monthRange.loading || (!settled && !monthRange.days.length);
  // Only the coach line reads this, and it is the slowest call Health makes.
  const dash = useApiResource('api/v1/health/dashboard', { enabled: active && settled, label: 'dashboard', logger, swr: true });
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
  // What is on screen stayed; the latest refresh of it did not land.
  const staleResources = [['day', day.loaded, day.error], ['pending-review', pendingReview.data, pendingReview.error],
    ['observations', observations.data, observations.error]].filter(([, shown, error]) => shown && error).map(([name]) => name);
  const refreshFailed = staleResources.length > 0;
  const wasStale = useRef(false);
  useEffect(() => {
    if (refreshFailed === wasStale.current) return;
    wasStale.current = refreshFailed;
    if (refreshFailed) logger.warn('refresh.failed', { date, resources: staleResources });
    else logger.info('refresh.recovered', { date });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshFailed]);
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

  // Photo and voice submissions land immediately as an already-logged
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
  // New food says where it landed and offers the wrong-day fix. A capture is new
  // food when it has a log ID (a meal instruction or amend has none); `added` is
  // for routes that only ever add, whose results carry no parsed log.
  const captureUndo = (result, targetDate, { added = Boolean(result.logId) } = {}) => {
    const undo = { token: result.undoToken ?? null, label: 'Meal updated' };
    const rows = result.items || (result.item ? [result.item] : []);
    const foods = rows.filter(row => row.kind !== 'group');
    const ids = [...new Set([...(result.entryIds || []), ...(result.affectedIds || []), ...rows.map(entryId)].filter(Boolean).map(String))];
    const findable = ids.length > 0 || (result.logId && !SHARED_LOG_IDS.has(result.logId));
    if (!added || !foods.length || !findable) return undo;
    const landed = foods[0].date || result.date || targetDate;
    const what = foods.length === 1 ? entryLabel(foods[0]) : `${foods.length} foods`;
    // A meal is named only when every food is in it.
    const oneMeal = new Set(foods.map(row => row.mealTime ?? null)).size === 1;
    const mealId = oneMeal ? result.mealTime || result.bucket || foods[0].mealTime : null;
    return { ...undo, label: capturePlace(what, landed, mealId), offer: { logId: result.logId, ids, what, date: landed } };
  };
  const showAdded = undo => {
    if (undo.offer) logger.info('capture.offer', { logId: undo.offer.logId ?? null, count: undo.offer.ids.length, date: undo.offer.date, undo: Boolean(undo.token) });
    setCaptureToasts(state => announceCapture(state, undo));
  };
  // For every add outside the capture flow. True when the toast now reports it.
  const offerAddedFood = (result, targetDate, options) => {
    if (result?.committed !== true) return false;
    const undo = captureUndo(result, targetDate, options);
    if (!undo.offer) return false;
    showAdded(undo);
    return true;
  };
  // A capture's Undo stops working once its rows change, so a toast retires only
  // after a real move. Anything else leaves it for another try. Food filed on
  // another day is read from that day and moved from there.
  const moveOffered = async (shown, iso) => {
    const offer = shown?.offer;
    if (!offer) return;
    const today = todayISO();
    const say = message => { setCaptureRetry(null); setCaptureNotice(message); };
    const elsewhere = offer.date !== date;
    const landedDay = dayLabel(offer.date, today);
    let items = movedDay.items;
    if (elsewhere) {
      try {
        const landed = await DaylightAPI(healthDayPath(offer.date));
        items = landed?.items || landed?.data || [];
      } catch (err) {
        logger.warn('capture.move-day.load_failed', { date: offer.date, error: err?.message });
        say(`Couldn't load ${landedDay}. Try again.`);
        return;
      }
    }
    const { entries, blocked } = captureEntries(items, offer);
    logger.info('capture.move-day', { logId: offer.logId, count: entries.length, blocked: blocked.length, from: offer.date, to: iso });
    if (!entries.length) {
      const loading = !elsewhere && (day.loading || day.revalidating);
      say(blocked.length ? `${stayedInDish(blocked)}.` : loading ? 'Those foods are still loading. Try again in a moment.'
        : `Those foods are no longer on ${elsewhere ? landedDay : 'this day'}.`);
      return;
    }
    // A finished move retires the toast by itself (afterCompletedMove).
    const report = outcome => {
      logger.info('capture.move-day.result', { logId: offer.logId, outcome, to: iso });
      if (outcome === MoveResult.MOVED && blocked.length) say(`${stayedInDish(blocked)}, so ${blocked.length === 1 ? 'it' : 'they'} stayed.`);
      else if (outcome === MoveResult.UNCHANGED) say(`Those foods are already on ${dayLabel(iso, today)}.`);
    };
    const onRetryable = retry => {
      const retryMove = retry && Object.assign(async () => {
        logger.info('capture.move-day.retry', { logId: offer.logId, to: iso });
        report(await retry());
      }, { operationId: retry.operationId });
      const moveFailure = retry ? unconfirmedMoveText(offer.what, dayLabel(iso, today)) : null;
      setCaptureToasts(state => updateOffer(state, offer, shown => ({ ...shown, retryMove, moveFailure })));
    };
    report(await moves.moveFromDay(entries, iso, elsewhere ? items : null, { onRetryable }));
  };

  // A reply from the day input, for the day it was asked on (`asked`), which may
  // no longer be the one on screen. Added food gets the capture toast; a move or
  // a change gets the service's sentence with Undo; anything else is a notice.
  const handleDayInput = (result, { date: asked }) => {
    if (result?.outcome !== 'committed') { setDayNotice(result?.message || null); return; }
    day.reload(); pendingReview.reload();
    setDayNotice(null);
    if (!captureRetry) setCaptureNotice(null);
    // A replayed reply can come without the flag the capture toast reads.
    if (result.kind === 'added' && offerAddedFood({ ...result, committed: true }, asked, { added: true })) return;
    if (!result.undoToken) { setDayNotice(result.message || null); return; }
    const rows = result.items || [];
    const moved = { ids: [...new Set([...(result.entryIds || []), ...(result.affectedIds || []), ...rows.map(entryId)].map(String))],
      logIds: [...new Set(rows.map(row => row.logId).filter(Boolean))], toDate: result.toDate ?? null };
    setCaptureToasts(state => announceCapture(result.kind === 'moved' ? afterCompletedMove(state, moved) : state,
      { token: result.undoToken, label: result.message || 'Day updated' }));
  };

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
      const undo = captureUndo(result, targetDate);
      // The toast names the meal itself, so the moved cue would repeat it.
      setCaptureNotice(result?.moved && !undo.offer ? `Moved to ${bucketLabel(result.mealTime)}` : null);
      showAdded(undo);
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

  // Wraps any capture submit (photo/voice) with the in-place pending
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

  const closeBarcode = () => {
    setCaptureMode(null);
    barcodeShortcut.current = false;
    if (searchParams.get('capture') === 'barcode') {
      setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('capture'); return next; }, { replace: true });
    }
  };
  const openBarcode = (bucketId = null) => {
    barcodeShortcut.current = false;
    setBarcodeTargetBucket(bucketId || (date === todayISO() ? currentMealBucketId() : BUCKETS[0].id));
    setBarcodeDate(date);
    setCaptureMode('barcode');
  };

  // Picking closes the menu, and the ⋯ button goes with the meal's foods. The toasts
  // take focus once the move has ended, whichever way it ended.
  const [menuMoveSettled, setMenuMoveSettled] = useState(0);
  const moveFromMealMenu = async (bucketId, run) => {
    const outcome = await run();
    logger.debug('meal-menu.move.settled', { bucketId, outcome });
    setMenuMoveSettled(count => count + 1);
  };
  const bucketHeaderAction = (bucketId, rows, label) => {
    if (!rows.length) return null;
    return <Menu position="bottom-end" classNames={MENU_CLASSES}>
      <Menu.Target><ActionIcon className="health-meal__capture-btn" variant="subtle" aria-label={`${label} actions`}>⋯</ActionIcon></Menu.Target>
      <Menu.Dropdown>
        {date !== todayISO() ? <Menu.Item onClick={() => copyMealToToday(rows, bucketId, label)}>Copy to today</Menu.Item> : null}
        <Menu.Item onClick={() => saveBucketAsMeal(rows, label)}>Save as meal</Menu.Item>
        <Menu.Divider />
        <Menu.Label>Move all to day</Menu.Label>
        <MoveDayItems date={date} today={todayISO()} onPick={iso => moveFromMealMenu(bucketId, () => moves.moveToDay(mealEntries(rows), iso))} />
        <Menu.Divider />
        <Menu.Label>Move all to</Menu.Label>
        {BUCKETS.filter(bucket => bucket.id !== bucketId).map(bucket => <Menu.Item key={bucket.id}
          aria-label={`Move all of ${label} to ${bucket.label}`} onClick={() => moveFromMealMenu(bucketId, () => moves.moveMeal(mealEntries(rows), bucket.id, bucketId))}>{bucket.label}</Menu.Item>)}
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

  const undoMealChange = async (tokenToUndo, reportFailure, stableOperationId) => {
    const token = typeof tokenToUndo === 'string' ? tokenToUndo : mealUndo?.token;
    if (undoPending.current || !token) return false;
    undoPending.current = true; setUndoBusy(true);
    const barcodeReceipt = [...(healthOperations?.snapshot.operations.values() || [])].find(op =>
      op.kind === 'barcode-commit' && (op.receipt?.undoToken || op.response?.undoToken) === token);
    const operationId = mealUndoOperations.current.get(token) || stableOperationId
      || (barcodeReceipt ? `undo-${barcodeReceipt.id}` : crypto.randomUUID());
    mealUndoOperations.current.set(token, operationId);
    const onThisUndo = change => setCaptureToasts(state => (state.undo?.token === token ? { ...state, undo: change(state.undo) } : state));
    onThisUndo(undo => ({ ...undo, failure: null }));
    try {
      // The sheet can outlive the page's latest Undo toast. Each token owns its retry.
      await foodAPI.withContinuation('api/v1/health/nutrition/meal-undo', { undoToken: token, operationId }, 'POST', () => {
        mealUndoOperations.current.delete(token);
        setCaptureToasts(state => afterMealUndo(state, token));
        healthOperations?.store.markBarcodeUndone(token);
        day.reload();
      });
      return true;
    } catch (err) {
      logger.warn('meal-undo.failed', { status: err?.status, error: err?.message });
      if (isDefiniteRefusal(err)) {
        foodAPI.release(operationId);
        mealUndoOperations.current.delete(token);
        const failure = refusalReason(err) || "Couldn't undo that.";
        if (reportFailure) reportFailure(failure);
        else setCaptureNotice(failure);
      } else {
        const failure = "Couldn't confirm that undo. Try again when connected.";
        reportFailure?.(failure);
        onThisUndo(undo => ({ ...undo, failure }));
      }
      return false;
    } finally { undoPending.current = false; setUndoBusy(false); }
  };
  const undoDeletedEntry = async () => {
    if (undoPending.current || !undoDelete) return;
    undoPending.current = true; setUndoBusy(true);
    try {
      await foodAPI('api/v1/health/nutrition/restore', { entryIds: undoDelete.entryIds }, 'POST');
      setUndoDelete(null); day.reload();
    } catch (err) {
      logger.warn('entry.restore_failed', { status: err?.status, error: err?.message });
      setCaptureNotice(refusalReason(err) || "Couldn't bring that back. Try again when connected.");
    } finally { undoPending.current = false; setUndoBusy(false); }
  };
  // A move with no known outcome is reported by whatever is showing it. Anything
  // no longer showing one falls to the page's toast, which can retry or release it.
  const shownMoves = new Set([sheetMove, moves.undo?.operationId, mealUndo ? mealUndoOperations.current.get(mealUndo.token) : null,
    ...[mealUndo, ...captureToasts.offers].map(shown => shown?.retryMove?.operationId)].filter(Boolean));
  const unresolvedMoves = moves.unresolved.filter(move => !shownMoves.has(move.id));
  // A portion edit's error is shown on its own row (EntryRow). The one case
  // with no row to sit on — the entry left the day — falls back to a toast.
  const portionControl = { ...preview.control, reloadDay: day.reload };
  const strandedPortion = !coldLoading && draftHasAlert(preview.control.draft) && !dayHasEntry(movedDay.items, entryId(preview.control.draft.row));

  const history = <>
    <WeekStrip enabled={active} date={date} today={todayISO()} onDateChange={setDate} viewportEnd={viewportEnd}
      onViewportChange={value => setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('week', value); return next; })} />
    {active ? <WeightChip asOf={date} /> : null}
    {wideViewport ? <MonthBlock days={monthRange.days} loading={monthLoading} /> : null}
    {wideViewport ? <Suspense fallback={null}><IntakeBurnChart days={monthRange.days} loading={monthLoading} /></Suspense> : null}
  </>;

  return (
    <PortionContext.Provider value={portionControl}><div className="health-today">
      <EquationStrip budget={preview.budget} baseline={day.budget} budgetError={day.budgetError} goals={preview.budget?.goals}
        macroCoverage={nutrientSummary(preview.items)} date={date} today={todayISO()}
        onDateChange={setDate} onSetupGoals={onSetupGoals}
        dayClose={!coldLoading ? <DayClosePill date={date} dayStatus={day.dayStatus} items={day.items} onChanged={day.reload} /> : null} />
      {/* Watch-micro bars sit directly under the summary (F4.1); the macros
          moved into the summary itself. They read the SAME day sums the budget
          does — BudgetService computes both over one fold — so the bars and the
          kcal number can never disagree. */}
      <MacroBarRow macros={preview.budget?.macros} goals={preview.budget?.goals}
        macroCoverage={nutrientSummary(preview.items)} microCoverage={preview.budget?.microCoverage}
        showIntake={false} showMacros={false} />
      {/* Follow-ups arrive on their own schedule (a 15 s poll, a scale), so they
          take no room on the page: a bell in the header (followUpTarget). */}
      <FollowUpTray active={active} target={followUpTarget} observations={unmatched}
        onObservationsChanged={() => observations.reload()} onChanged={day.reload} />
      {wideViewport && sidebarTarget ? createPortal(history, sidebarTarget) : null}
      <TodayToasts captureNotice={captureNotice} captureRetry={captureRetry} retryBusy={nutrition.busy}
        onRetryCapture={retryVoiceCapture} onDismissCapture={() => { setCaptureNotice(null); setCaptureRetry(null); }}
        orphanRetry={orphanRetry} onRetryOrphan={retryOrphanedRecording} onDismissOrphan={() => setOrphanRetry(null)}
        moves={moves} unresolvedMoves={unresolvedMoves} mealUndo={mealUndo} onUndoMeal={undoMealChange} onDismissMealUndo={clearMealUndo}
        onSupersedeMealUndo={() => setCaptureToasts(state => supersedeCaptureUndo(moves.undo?.moved ? afterCompletedMove(state, moves.undo.moved) : state))}
        undoDelete={undoDelete} onUndoDelete={undoDeletedEntry} onDismissUndoDelete={() => setUndoDelete(null)} undoBusy={undoBusy}
        strandedPortion={strandedPortion ? portionControl : null} today={todayISO()} onMoveCapture={iso => moveOffered(mealUndo, iso)}
        dayOffers={captureToasts.offers} onMoveOffer={moveOffered}
        dayNotice={dayNotice} onDismissDayNotice={() => setDayNotice(null)} menuMoveSettled={menuMoveSettled} handedBackMove={handedBackMove}
        onDismissOffer={shown => setCaptureToasts(state => ({ ...state, offers: state.offers.filter(item => item.offer !== shown.offer) }))} />
      <ConfirmDialog open={Boolean(pendingDelete)} title={pendingDelete ? `Delete ${entryLabel(pendingDelete)}?` : ''}
        body={pendingDelete ? deleteConfirmBody(pendingDelete) : ''} busy={deleteBusy} error={deleteError}
        onConfirm={confirmDelete} onCancel={() => { setPendingDelete(null); setDeleteError(null); }} />
      {/* A refresh that fails (the 15 s poll while the backend restarts) keeps
          what is on screen and says so in one line. A panel only when there
          is nothing to show, and one per outage: when the day itself failed,
          the review and measurement failures are the same outage. */}
      {day.error && !day.loaded ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {!day.error && pendingReview.error && !pendingReview.data ? <ErrorState error={pendingReview.error} onRetry={pendingReview.reload} label="Food review unavailable" /> : null}
      {!day.error && observations.error && !observations.data ? <ErrorState error={observations.error} onRetry={observations.reload} label="Measurements unavailable" /> : null}
      {refreshFailed ? <Button variant="subtle" size="compact-xs" color="gray" className="health-refresh-failed" onClick={day.reload}>
        Couldn't refresh · Retry</Button> : null}
      <DayInputBar date={date} today={todayISO()} active={active} entries={dayEntries(movedDay.items)} onResult={handleDayInput}
        onMoveDay={(rows, iso, options) => moves.moveFromDay(rows, iso, null, options)} onClaimMove={setSheetMove} onMoveHandedBack={setHandedBackMove} />
      <LogTable clarifications={mealClarifications} onClearClarification={clearMealClarification} byBucket={preview.byBucket} date={date} sessions={preview.budget?.sessions || []}
        exerciseAvailable={Boolean(day.budget)}
        fastedMeals={day.dayStatus?.fastedMeals || []} onMealFastChanged={day.reload}
        coldLoading={coldLoading} capturePendingBuckets={[...capturePending.values()].filter(pending => pending.date === date).map(pending => pending.bucket)}
        onRowTap={setEditingRow} onConfirm={day.reload} onRequestDelete={row => { setDeleteError(null); setPendingDelete(row); }}
        bucketHeaderAction={bucketHeaderAction}
        onVoiceCapture={onVoiceCapture} onTextCapture={onTextCapture}
        onMealChanged={result=>handleCaptureResult(result)} captureTasks={[...capturePending.values()]}
        hiddenIds={moves.hiddenIds} measuredByUuid={measuredByUuid} addedIds={addedIds} onMoveEntry={moves.move} onMoveMeal={moves.moveMeal} onMoveToDay={moves.moveToDay}
        onNotice={message => { setCaptureRetry(null); setCaptureNotice(message); }}
        renderAddRow={(bucket, label, meal) => <MealAddRow bucket={bucket} label={label} date={date} active={active}
          onVoiceCapture={meal?.onVoiceCapture} selectedCount={meal?.selectedIds?.length || 0} busy={false} onOrphanedRetry={keepOrphanedRecording}
          onAdded={() => day.reload()} onFoodAdded={offerAddedFood} onSentencePending={text => beginSentencePending(bucket, text)} onPhotoCapture={onPhotoCapture} onOpenBarcode={openBarcode}
          onOpenTemplates={(target, templateId) => { setFocusTemplateId(templateId); setTemplatesFor(target); }}
          onManageFoods={() => setManageFoods(true)} />} />
      <NeedsReviewSection pending={pendingLogs} onChanged={day.reload} onConfirmed={(entry, placed) => offerAddedFood(
        { committed: true, logId: entry.id, items: entry.items, date: placed.date || entry.date, mealTime: placed.mealTime }, date)} />
      {!wideViewport || !sidebarTarget ? <details className="health-history"><summary>Week &amp; weight history</summary>{history}</details> : null}
      {coachLine ? <Button variant="subtle" onClick={() => onCoachTap()}>{coachLine}</Button> : null}
      <BarcodeOperationStatus open={active && captureStatusOpen} onClose={closeHealthCaptureStatus}
        undoBusy={undoBusy} onUndo={undoMealChange} onView={receipt => {
          setSelectedCapture(receipt);
          setSearchParams(previous => {
            const next = new URLSearchParams(previous);
            next.delete('capture');
            if (receipt.date !== date) {
              next.set('date', receipt.date);
              next.set('week', weekEnd(receipt.date));
            }
            return next;
          }, { replace: true });
        }} />
      <BarcodeCapture open={active && captureMode === 'barcode'} quickScan={barcodeShortcut.current} bucket={barcodeTargetBucket || currentMealBucketId()}
        meals={BUCKETS.map(meal => ({ value: meal.id, label: meal.label }))}
        undoBusy={undoBusy} onUndo={undoMealChange}
        onClose={() => {
          if (barcodeShortcut.current) window.dispatchEvent(new Event('daylight:barcode-shortcut-done'));
          closeBarcode();
        }} onStatus={barcodeShortcut.current ? undefined : showHealthCaptureStatus}
        onDecode={(upc, _bucket, signal) => nutrition.lookupBarcode(upc, signal)}
        onConfirm={prepared => nutrition.commitBarcode({ ...prepared, date: barcodeDate }, result => {
          offerAddedFood(result, barcodeDate, { added: true });
        })}
        onUnknown={(upc, bucket) => { closeBarcode(); setBarcodeTargetBucket(bucket); setUnknownUpc(upc); }}
        onDone={() => {
          if (barcodeShortcut.current) window.dispatchEvent(new Event('daylight:barcode-shortcut-done'));
          closeBarcode();
        }}
        onView={result => {
          closeBarcode();
          const row = (result.items || []).find(item => String(entryId(item)) === result.entryIds[0]);
          if (row) { if (row.date !== date) setDate(row.date); setEditingRow(row); }
        }} />
      <CustomFoodSheet upc={unknownUpc} open={active && Boolean(unknownUpc)}
        bucketId={barcodeTargetBucket} date={barcodeDate}
        onClose={() => setUnknownUpc(null)}
        onCreated={logged => { setUnknownUpc(null); day.reload(); offerAddedFood(logged, barcodeDate, { added: true }); }} />
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
        onLogged={logged => { setTemplatesFor(null); setFocusTemplateId(null); day.reload(); offerAddedFood(logged, date, { added: true }); }}
        onClose={() => { setTemplatesFor(null); setFocusTemplateId(null); }} />
    </div></PortionContext.Provider>
  );
}
export default TodayView;
