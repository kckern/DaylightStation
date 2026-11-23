import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getToken } from '../../../lib/auth.js';
import { invalidateApiResources } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/index.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { DEFAULT_SCOPE, WIDEN_STEP, actionKeysFor, effectButton, hasVerdict, isOpen, isSceneRow, keysKindOf, needsCheck, nextKind, plays, scopeRows, stageScope, stepFrom, triedRefine } from './reviewScope.js';
import { defaultStage, railStages } from './railStages.js';
import { effectChoices } from './RowEditor.jsx';
import { BLEEP_LEVEL_DEFAULT, clampBleepLevel } from '../../../../../shared/contracts/content-filter/filterSettings.mjs';

/**
 * The review station's state machine: cursor, scope, verdicts, in-place action changes, undo,
 * auto-advance, dwell/replay counting and the observability events. The page owns the selected row
 * (single source of truth, mirrored to the URL); this hook only moves it through `select`.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const round3 = (v) => Math.round(v * 1000) / 1000;
const SCENE_EFFECTS = new Set(['skip', 'blackout', 'off']);
const UNSAVED_TIMING = 'Unsaved timing: Save or press Esc to drop it';
// A held [ or ] changes the level many times a second; the film's setting is written once it settles.
const LEVEL_DEBOUNCE_MS = 400;
const REWORK_ARM_MS = 4000;
const levelWrites = new Map();
const FOLLOW = 'follow';

function levelWriteOwner() {
  try { return getToken(); } catch { return null; }
}

function enqueueLevelWrite(path, owner, value) {
  const key = JSON.stringify([path, owner]);
  const previous = levelWrites.get(key);
  const send = async () => {
    if (levelWriteOwner() !== owner) return false;
    await DaylightAPI(path, { settings: { bleepLevel: value } }, 'PUT');
    return true;
  };
  const pending = previous ? previous.then(send, send) : Promise.resolve().then(send);
  levelWrites.set(key, pending);
  const release = () => { if (levelWrites.get(key) === pending) levelWrites.delete(key); };
  void pending.then(release, release);
  return pending;
}

export function useReviewStation({ ratingKey, data, reload, refreshReview, selected, select, activeView, runBusy = false, openRowId = null }) {
  const rk = String(ratingKey);
  const rows = data?.rows;
  const [chosenScope, setScopeState] = useState(null);
  const [message, setMessage] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const arrived = useRef({ id: null, at: Date.now(), replays: 0 });
  const via = useRef('click');
  const latest = useRef({});
  latest.current = { rows, selectedId: selected?.id ?? null, scoped: null, scope: null };

  // Which parts a refine holds or still has to pin (the Refine tab lists these).
  const [pendingRefine, setPendingRefine] = useState(() => new Set());
  const notMatched = data?.match === 'unmatched';
  const job = data?.job || null;
  const running = Boolean(job && (job.status === 'queued' || job.status === 'running'));
  const refineTargets = useMemo(() => (rows || []).filter((r) => !plays(r) && !isSceneRow(r)), [rows]);
  // Rough parts refine has already tried (it left a refine-* reason: not found, coarse edges, …) stay
  // rough when refined again; they are checked by eye, and never hold back Refine all or approval
  // (review 2026-11-22: Sonic's picture parts kept coarse edges, so "Refine all 5" looped).
  const triedBefore = triedRefine;
  const roughRefineTargets = useMemo(() => refineTargets.filter((r) => r.timing === 'rough' && !triedBefore(r)), [refineTargets]);
  // Every part refine left a reason on (not found, coarse edges, …), whatever its timing now says,
  // that nobody has looked at yet: the rail counts these "to check" (it said "Done": review 2026-11-22).
  const roughLeftCount = useMemo(() => refineTargets.filter(needsCheck).length, [refineTargets]);
  const cuesOf = (r) => (isSceneRow(r) ? [] : (r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : [])));
  // Which rows a refine holds right now: the open send-back's parts, then the ones queued here.
  const refining = useMemo(() => {
    const out = {};
    if (job && job.kind === 'send-back' && running) {
      const cues = new Set(job.cues || []);
      for (const r of rows || []) if ((r.members || []).some((id) => cues.has(id))) out[r.id] = job.status === 'queued' ? 'Waiting' : 'Refining…';
    }
    for (const r of rows || []) if (!out[r.id] && (r.members || []).some((id) => pendingRefine.has(id))) out[r.id] = 'Queued';
    return out;
  }, [rows, job, running, pendingRefine]);
  latest.current.refining = refining;
  latest.current.running = running;
  // The tally counts the parts that need a verdict: the filtered ones (parts that play need none).
  const tally = useMemo(() => {
    const filtered = (rows || []).filter((r) => !plays(r));
    return { done: filtered.filter(hasVerdict).length, total: filtered.length, redo: (rows || []).filter((r) => r.verdict?.verdict === 'redo').length };
  }, [rows]);

  // The rail's stages, and the tab the film opens on: its first stage still to do, fixed when the
  // film's parts first arrive (a permalink opens the tab its part is on). After that the tab is the
  // reviewer's choice; a stage finishing never moves them.
  const stages = useMemo(() => railStages({ data, tally, roughRefine: roughRefineTargets.length, roughLeft: roughLeftCount }),
    [data, tally, roughRefineTargets, roughLeftCount]);
  const arrival = useRef(null);
  if (!arrival.current && rows) {
    let stage = defaultStage(stages);
    const linked = openRowId ? rows.find((r) => r.id === openRowId) : null;
    if (linked) stage = plays(linked) ? 'plays' : stage === 'refine' && scopeRows([linked], stageScope(DEFAULT_SCOPE, 'refine'), { refining }).length ? 'refine' : 'review';
    arrival.current = stageScope(DEFAULT_SCOPE, stage);
  }
  const scope = chosenScope ?? arrival.current ?? DEFAULT_SCOPE;
  latest.current.scope = scope;
  const arrived0 = Boolean(rows);
  useEffect(() => {
    if (arrived0) logger.info('content_filter.review.stage_tab', { rk, stage: arrival.current.stage, from: null, via: 'default' });
  }, [arrived0, rk]);

  const scoped = useMemo(() => scopeRows(rows, scope, { refining }), [rows, scope, refining]);
  latest.current.scoped = scoped;
  const row = rows?.find((r) => r.id === selected?.id) || null;

  // Dwell and replays count per cursor stay; a permalink or a click arrives here too.
  useEffect(() => {
    arrived.current = { id: selected?.id ?? null, at: Date.now(), replays: 0 };
    if (selected?.id) {
      logger.debug('content_filter.review.cursor', { rk, rowId: selected.id, via: via.current });
      [...document.querySelectorAll('.cf-review__list [data-row-id]')].find((n) => n.getAttribute('data-row-id') === selected.id)?.scrollIntoView?.({ block: 'nearest' });
    }
    via.current = 'click';
  }, [selected?.id, rk]);

  // One session per film while the page is open.
  const session = useRef(null);
  useEffect(() => {
    if (!rows || session.current?.rk === rk) return;
    session.current = { rk, at: Date.now() };
    logger.info('content_filter.review.session.start', { rk, rows: rows.length, reviewed: rows.filter(hasVerdict).length });
  }, [rows, rk]);
  useEffect(() => () => {
    const s = session.current; if (!s) return;
    const list = latest.current.rows || [];
    logger.info('content_filter.review.session.end', { rk: s.rk, rows: list.length, reviewed: list.filter(hasVerdict).length, durationMs: Date.now() - s.at });
    session.current = null;
  }, [rk]);

  // A span dragged on the timing strip and not saved yet (RowEditor reports it): moving the cursor
  // would drop it without a word, so stepping, picking and verdicts wait for Save or Esc.
  const dirtyTiming = useRef(null);
  const timingDirty = useCallback((drop) => {
    // A new draft makes "Timing change dropped." stale (review 2026-11-22).
    if (drop && !dirtyTiming.current) setMessage((m) => (m === 'Timing change dropped.' ? null : m));
    dirtyTiming.current = drop || null;
  }, []);
  const heldByTiming = (what) => {
    if (!dirtyTiming.current) return false;
    logger.info('content_filter.review.unsaved_timing_blocked', { rk, rowId: latest.current.selectedId, what });
    setMessage(UNSAVED_TIMING);
    return true;
  };

  const go = useCallback((r, how) => {
    if (!r) return;
    via.current = how;
    setMessage(null);
    select(r);
    previewStore.jumpToCue({ in: r.in });
  }, [select]);
  // Every cursor move seeks to in - PREVIEW_LEAD_SEC (jumpToCue): click, timeline, keys, auto-advance.
  const pick = useCallback((r, { seek = true } = {}) => {
    if (r?.id !== latest.current.selectedId && heldByTiming('pick')) return false;
    via.current = 'click'; setMessage(null); select(r);
    previewStore.unpeek();
    if (seek) previewStore.jumpToCue({ in: r.in });
    return true;
  }, [select]); // eslint-disable-line react-hooks/exhaustive-deps
  const setScope = useCallback((next) => {
    setScopeState(next);
    setMessage(null);
    logger.info('content_filter.review.scope', { rk, stage: next.stage, show: next.show, order: next.order, timing: next.timing, kind: next.kind, action: next.action, needs: next.needs, group: next.group, shown: scopeRows(latest.current.rows, next, { refining: latest.current.refining }).length });
  }, [rk]);
  // A rail tab: the scope moves to that stage's parts, and the cursor follows when the part in hand
  // is not among them (Approve shows its own panel and leaves the cursor alone).
  const setStage = useCallback((stage, how = 'click', { keepCursor = false } = {}) => {
    const from = latest.current.scope.stage;
    if (stage === from) return;
    if (heldByTiming('tab')) return;
    const next = stageScope(latest.current.scope, stage);
    const list = scopeRows(latest.current.rows, next, { refining: latest.current.refining });
    setScopeState(next);
    setMessage(null);
    logger.info('content_filter.review.stage_tab', { rk, stage, from, via: how, shown: list.length });
    if (keepCursor || stage === 'approve' || list.some((r) => r.id === latest.current.selectedId)) return;
    const first = list.find((r) => isOpen(r, next)) || list[0];
    if (first) pick(first);
  }, [rk, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir) => {
    if (heldByTiming('step')) return;
    const next = stepFrom(scoped, selected?.id, dir);
    if (next) go(next, 'key'); else setMessage(dir > 0 ? 'That is the last part in this view.' : 'That is the first part in this view.');
  };

  // Runs when a save lands: read the CURRENT scope/rows, and leave a cursor the user moved meanwhile.
  const advance = (from) => {
    if (latest.current.selectedId !== from.id) return;
    // A part being refined is skipped: its verdict waits for the new timing.
    const list = (latest.current.scoped || []).filter((r) => r.id === from.id || !latest.current.refining?.[r.id]);
    const sc = latest.current.scope || DEFAULT_SCOPE;
    const next = stepFrom(list, from.id, 1, { onlyOpen: true, scope: sc });
    if (next) { go(next, 'auto'); return; }
    const open = list.filter((r) => r.id !== from.id && isOpen(r, sc)).length;
    setMessage(open ? `End of this view. ${open} still open above.` : `All ${list.length} in this view reviewed.`);
  };

  const guarded = async (key, fn) => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { await fn(); } catch (err) {
      logger.warn('content_filter.review.action_failed', { rk, rowId: selected?.id, key, error: err.message });
      if (activeView.current) setMessage(err.message || 'That did not work.');
    } finally {
      busy.current = false;
      if (activeView.current) setSaving(false);
    }
  };

  const record = async (r, verdict, { reason, change } = {}) => {
    const dwellMs = Date.now() - arrived.current.at;
    const replays = arrived.current.replays;
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/review/${encodeURIComponent(r.id)}`,
      { span: [r.in, r.out], verdict, ...(reason ? { reason } : {}), ...(change ? { change } : {}), dwellMs, replays }, 'PUT');
    logger.info('content_filter.review.verdict', { rk, rowId: r.id, kind: r.kind, category: r.group, effect: r.effect, verdict, ...(reason ? { reason } : {}), ...(change ? { change } : {}), dwellMs, replays });
    if (!activeView.current) return;
    setUndoStack((s) => [...s, { rowId: r.id, verdict, changed: Boolean(change) }]);
    reload();
    advance(r);
  };

  const verdict = (v, reason) => {
    if (!row) return;
    if (heldByTiming('verdict')) return;
    // A refine moves the part, which drops a verdict on it: wait for the new timing (review 2026-11-21).
    if (plays(row)) { setMessage('This part plays under your settings and needs no verdict. Press an effect key to filter it.'); return; }
    if (latest.current.refining?.[row.id]) { setMessage('This part is being refined. Give it a verdict when the new timing lands.'); return; }
    // The Refine tab shows no verdict buttons (a verdict resets when its part is refined).
    if (latest.current.scope?.stage === 'refine') { setMessage('Verdicts are given on the Review tab.'); return; }
    if (v === 'remove' && latest.current.running) { setMessage('Let it play waits until the refine finishes.'); return; }
    guarded('verdict', () => record(row, v, { reason }));
  };

  const callsFor = (r, body) => {
    const base = `${API}/${encodeURIComponent(rk)}`;
    if (isSceneRow(r)) return [[`${base}/scenes/${encodeURIComponent(r.peekId)}`, body, 'PUT']];
    const members = r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : []);
    return members.map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']);
  };

  // `target` is a row other than the cursor (its effect icon in the list); it is taken in hand first.
  const effect = (letter, target = row) => {
    const row = target;
    if (!row) return;
    const entry = actionKeysFor(keysKindOf(row)).find(([k]) => k.toLowerCase() === letter);
    if (!entry) return;
    const [, label, to] = entry;
    if (latest.current.refining?.[row.id]) { setMessage('This part is being refined. Change its effect when the new timing lands.'); return; }
    guarded('effect', async () => {
      const allowed = isSceneRow(row) ? SCENE_EFFECTS.has(to) : effectChoices(row.modality).some((o) => o.value === to);
      if (!allowed) { setMessage(`${label} does not fit this part.`); return; }
      if (plays(row) ? to === 'off' : effectButton(row.effect) === to) { setMessage(`Already ${label.toLowerCase()}.`); return; }
      for (const [path, body, method] of callsFor(row, { effect: to })) await DaylightAPI(path, body, method);
      // An effect change is not a verdict (it used to approve and move on, unseen: review 2026-11-22):
      // the part replays with its new effect and waits for A.
      logger.info('content_filter.review.effect', { rk, rowId: row.id, kind: row.kind, from: row.effect, to });
      if (!activeView.current) return;
      setMessage(to === 'off' ? 'Off: this part now plays. Press → for the next part.' : `${label} applied. Watch it, then press A to approve.`);
      reload();
      // The player reads its filter once: refresh it, then play the part again with the new effect.
      const accepted = await previewStore.refresh().catch(() => false);
      if (!activeView.current || latest.current.selectedId !== row.id) return;
      if (accepted) previewStore.jumpToCue({ in: row.in });
      else { logger.warn('content_filter.review.effect_preview_stale', { rk, rowId: row.id }); setMessage(`${label} applied, but the preview could not refresh. Press Enter to play the part, then A to approve.`); }
    });
  };

  // "Use household settings" from the part menu: the part's own effect is dropped (as RowEditor's
  // effect menu does), so the household's settings decide again.
  const settings = (target = row) => {
    if (!target) return;
    if (latest.current.refining?.[target.id]) { setMessage('This part is being refined. Change its effect when the new timing lands.'); return; }
    guarded('settings', async () => {
      for (const [path, body, method] of callsFor(target, { effect: 'profile', disabled: false })) await DaylightAPI(path, body, method);
      logger.info('content_filter.review.effect', { rk, rowId: target.id, kind: target.kind, from: target.effect, to: 'profile' });
      if (!activeView.current) return;
      setMessage('Back on the household settings.');
      reload();
      await previewStore.refresh().catch(() => false);
    });
  };

  const widen = () => {
    if (!row) return;
    guarded('widen', async () => {
      const single = isSceneRow(row) || (row.members ?? [row.peekId]).length === 1;
      if (!single) { setMessage('Widen one part at a time.'); return; }
      const to = { in: round3(Math.max(0, row.in - WIDEN_STEP)), out: round3(row.out + WIDEN_STEP) };
      for (const [path, body, method] of callsFor(row, { nudge: to })) await DaylightAPI(path, body, method);
      await record(row, 'approve', { change: { from: { in: row.in, out: row.out }, to } });
    });
  };

  const undo = () => guarded('undo', async () => {
    if (heldByTiming('undo')) return;
    if (latest.current.running) { setMessage('Undo waits until the refine finishes.'); return; }
    const last = undoStack[undoStack.length - 1];
    if (!last) { setMessage('Nothing to undo.'); return; }
    const target = latest.current.rows?.find((r) => r.id === last.rowId);
    // A remove is terminal once the re-audit lands: the row is gone and so is its verdict.
    // Keep a live target on the stack until its DELETE succeeds so an offline/transient failure can retry it.
    if (!target) { setUndoStack((s) => s.slice(0, -1)); setMessage('That part is already gone; it cannot be undone.'); return; }
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/review/${encodeURIComponent(last.rowId)}`, {}, 'DELETE');
    logger.info('content_filter.review.undo', { rk, rowId: last.rowId, undid: last.verdict });
    if (!activeView.current) return;
    setUndoStack((s) => s.slice(0, -1));
    reload();
    go(target, 'key');
  });

  // Rework: send every row marked redo back as one targeted run. Cue/subject rows go through
  // send-back with their member cue ids; scene rows have no cues, so they re-run the scenes stage.
  const flagged = useMemo(() => (rows || []).filter((r) => r.verdict?.verdict === 'redo'), [rows]);
  const rework = () => {
    if (!flagged.length) { setMessage('Nothing is flagged for redo.'); return; }
    if (runBusy) { setMessage('A run is already open for this film.'); return; }
    guarded('rework', async () => {
      const cues = [...new Set(flagged.flatMap((r) => (isSceneRow(r) ? [] : (r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : [])))))];
      const reasons = Object.fromEntries(flagged.filter((r) => r.verdict.reason).map((r) => [r.id, r.verdict.reason]));
      const body = cues.length ? { kind: 'send-back', cues, reasons } : { kind: 'stage', stage: 'scenes', reasons };
      await DaylightAPI(`${API}/${encodeURIComponent(rk)}/jobs`, body, 'POST');
      logger.info('content_filter.review.rework', { rk, rows: flagged.length, cues: cues.length, kind: body.kind, reasons: Object.keys(reasons).length });
      if (!activeView.current) return;
      const sceneRows = flagged.filter((r) => isSceneRow(r)).length;
      setMessage(cues.length && sceneRows ? `Sent ${flagged.length - sceneRows} back. ${sceneRows} scene part${sceneRows === 1 ? '' : 's'} stay flagged for the next run.` : `Sent ${flagged.length} back to the pipeline.`);
      reload();
    });
  };

  // Shift+D arms; a second press within REWORK_ARM_MS sends. The button click is one step (`rework`).
  const armed = useRef(null);
  const reworkKey = () => {
    if (!flagged.length || runBusy) { rework(); return; }
    if (armed.current) { clearTimeout(armed.current); armed.current = null; rework(); return; }
    setMessage(`Shift+D again to send ${flagged.length} for rework`);
    armed.current = setTimeout(() => { armed.current = null; setMessage((m) => (String(m || '').startsWith('Shift+D again') ? null : m)); }, REWORK_ARM_MS);
  };
  useEffect(() => () => clearTimeout(armed.current), []);

  const replay = () => {
    if (!row) return;
    arrived.current.replays += 1;
    // Filtered means filtered: an unfiltered peek still armed ends here.
    previewStore.unpeek();
    previewStore.jumpToCue({ in: row.in });
  };
  const togglePlay = () => {
    const to = previewStore.togglePlay();
    logger.debug('content_filter.review.toggle_play', { rk, to });
  };
  const playWithout = () => {
    if (!row) return;
    arrived.current.replays += 1;
    previewStore.peek(row.peekId);
  };

  const handFixedRefineArm = useRef(null);
  // Refine: one part (R) or every filtered part still on rough timing (Shift+R), as one send-back
  // of their member cues (owner, 2026-11-21: refine the flagged ones, never the 136 that play).
  // One run per film: presses while a run is open collect here and go out once it finishes well;
  // they stay queued (and say so) if it stopped or failed, and leave the queue only once sent.
  const sendRefine = async (cues, what) => {
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/jobs`, { kind: 'send-back', cues }, 'POST');
    logger.info('content_filter.review.refine', { rk, cues: cues.length, what });
    if (!activeView.current) return;
    setMessage(/filtered part/.test(what)
      ? `Refining ${what}. Watch them meanwhile; verdicts open when it finishes.`
      : `Refining ${what}. Review the other parts meanwhile.`);
    reload();
  };
  const queueRefine = (cues, what) => {
    if (notMatched) { setMessage('This film is not matched to Plex, so it cannot be refined.'); return; }
    // Anything still queued from a run that stopped counts too (review 2026-11-22).
    if (!cues.length && !(pendingRefine.size && !running)) { setMessage('Nothing to refine there.'); return; }
    if (running) {
      setPendingRefine((s) => new Set([...s, ...cues]));
      logger.info('content_filter.review.refine_queued', { rk, cues: cues.length, what });
      setMessage(`Queued: ${what} refines when the current run finishes.`);
      return;
    }
    // Anything still queued from a run that stopped goes out with this press.
    const all = [...new Set([...pendingRefine, ...cues])];
    guarded('refine', async () => { await sendRefine(all, what); setPendingRefine(new Set()); });
  };
  // A hand fix is dropped by a refine: the first R on a hand-fixed part asks, the second sends.
  const handFixArmed = useRef(null);
  const refine = () => {
    if (!row) return;
    if (heldByTiming('refine')) return;
    if (plays(row)) { setMessage('This part plays under your settings; refining is for the filtered parts.'); return; }
    // R on a part waiting in this page's queue takes it out again.
    const mine = cuesOf(row);
    if (running && mine.length && mine.every((id) => pendingRefine.has(id))) {
      setPendingRefine((s) => new Set([...s].filter((id) => !mine.includes(id))));
      setMessage(`"${row.label}" is out of the queue.`);
      return;
    }
    if (isSceneRow(row)) { setMessage('A scene is rebuilt with its parts; refine the parts in it.'); return; }
    if (row.handFixed && handFixArmed.current !== row.id) {
      handFixArmed.current = row.id;
      setMessage('Refining drops your hand-fixed timing on this part. Press R again to refine it.');
      return;
    }
    handFixArmed.current = null;
    queueRefine(cuesOf(row), `"${row.label}"`);
  };
  const refineAll = ({ again = false } = {}) => {
    const targets = again ? refineTargets : roughRefineTargets;
    const cues = [...new Set(targets.flatMap(cuesOf))];
    const handFixed = targets.filter((r) => r.handFixed);
    const judged = targets.filter((r) => r.verdict || r.reviewed);
    if (handFixed.length || judged.length) {
      const signature = [...cues].sort().join('\0');
      if (handFixedRefineArm.current?.signature !== signature) {
        clearTimeout(handFixedRefineArm.current?.timer);
        const timer = setTimeout(() => { handFixedRefineArm.current = null; }, REWORK_ARM_MS);
        handFixedRefineArm.current = { signature, timer };
        const count = handFixed.length;
        const lost = [count ? `saved hand-fixed timing on ${count} filtered part${count === 1 ? '' : 's'}` : null,
          judged.length ? `the verdict on ${judged.length} part${judged.length === 1 ? '' : 's'} you reviewed` : null].filter(Boolean).join(' and ');
        setMessage(`Refining will remove ${lost}. Press Shift+R or click Refine all again to continue.`);
        return;
      }
      clearTimeout(handFixedRefineArm.current.timer);
      handFixedRefineArm.current = null;
    } else {
      clearTimeout(handFixedRefineArm.current?.timer);
      handFixedRefineArm.current = null;
    }
    queueRefine(cues, `${targets.length} filtered part${targets.length === 1 ? '' : 's'}`);
  };
  useEffect(() => () => clearTimeout(handFixedRefineArm.current?.timer), []);
  // When the film's run closes: a finished run sends the queue; a stopped or failed one keeps it.
  const wasRunning = useRef(running);
  useEffect(() => {
    const was = wasRunning.current; wasRunning.current = running;
    if (!was || running || !pendingRefine.size) return;
    const cues = [...pendingRefine];
    if (job?.status !== 'done') {
      setMessage(`The run ${job?.status === 'cancelled' ? 'was stopped' : 'did not finish'}; ${cues.length} queued part${cues.length === 1 ? ' is' : 's are'} still waiting. Press R or Shift+R to send them.`);
      return;
    }
    DaylightAPI(`${API}/${encodeURIComponent(rk)}/jobs`, { kind: 'send-back', cues }, 'POST')
      .then(() => {
        logger.info('content_filter.review.refine', { rk, cues: cues.length, what: 'queued' });
        if (!activeView.current) return;
        setPendingRefine((s) => new Set([...s].filter((id) => !cues.includes(id))));
        setMessage(`Refining ${cues.length} queued part${cues.length === 1 ? '' : 's'}.`);
        reload();
      })
      .catch((err) => {
        logger.warn('content_filter.review.refine_failed', { rk, cues: cues.length, error: err.message });
        if (activeView.current) setMessage(`${err.message || 'The queued refine did not start.'} ${cues.length} still queued.`);
      });
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bleep level for this film: film ?? household ?? 0.25. The key moves a pending value at once
  // (shown in the key bar); one debounced write saves it, then the player re-reads its profile and
  // the cue replays so the reviewer hears the change.
  const [pendingLevel, setPendingLevel] = useState(null);
  const [pendingHousehold, setPendingHousehold] = useState(null);
  const [previewRecovery, setPreviewRecovery] = useState(null);
  const levelRef = useRef({ value: null, rowId: null, owner: null, timer: null, revision: 0, retrying: false });
  const householdLevel = pendingHousehold ?? data?.bleepLevel?.profile ?? BLEEP_LEVEL_DEFAULT;
  const savedLevel = data?.bleepLevel?.film ?? householdLevel;
  const bleepLevel = pendingLevel === FOLLOW ? householdLevel : (pendingLevel ?? savedLevel);
  const filmLevel = pendingLevel === FOLLOW ? null : (pendingLevel ?? data?.bleepLevel?.film ?? null);
  const refreshLevelPreview = useCallback(async (attempt) => {
    const st = levelRef.current;
    const accepted = await previewStore.refresh().catch(() => false);
    if (!activeView.current || st.revision !== attempt.revision || levelWriteOwner() !== attempt.owner) return;
    st.retrying = false;
    if (!accepted) {
      setPreviewRecovery(attempt);
      return;
    }
    setPreviewRecovery(null);
    if (latest.current.selectedId !== attempt.rowId) return;
    const selectedRow = latest.current.rows?.find((row) => row.id === attempt.rowId);
    if (selectedRow) previewStore.jumpToCue({ in: selectedRow.in });
  }, [activeView]);

  const saveLevel = useCallback(async () => {
    const st = levelRef.current;
    clearTimeout(st.timer);
    st.timer = null;
    const { value: queued, revision, rowId, owner } = st;
    if (queued == null) return;
    const value = queued === FOLLOW ? null : queued;
    st.value = null;
    const base = `${API}/${encodeURIComponent(rk)}`;
    const latestEdit = () => activeView.current && st.revision === revision;
    const isCurrent = () => latestEdit() && levelWriteOwner() === owner;
    const readBack = (cueId, saved) => {
      void refreshReview().catch(() => {}).finally(() => { if (isCurrent()) setPendingLevel(null); });
      void refreshLevelPreview({ revision, rowId: cueId, owner, saved });
    };
    try {
      if (!await enqueueLevelWrite(`${base}/settings`, owner, value)) {
        if (latestEdit()) setPendingLevel(null);
        return;
      }
      logger.info('content_filter.review.bleep_level', { rk, level: value, scope: 'film', value });
      if (isCurrent()) readBack(rowId, true);
      else if (levelWriteOwner() === owner) invalidateApiResources(path => path === `${base}/review`);
    } catch (err) {
      logger.warn('content_filter.review.bleep_level_failed', { rk, level: value, error: err.message });
      if (isCurrent()) {
        setMessage(err.message || 'The bleep level did not save.');
        // A prior write can have committed while this newer edit was queued.
        readBack(null, false);
      }
    }
  }, [rk, refreshReview, activeView, refreshLevelPreview]);
  const retryPreview = () => {
    const st = levelRef.current;
    if (!previewRecovery || st.retrying || levelWriteOwner() !== previewRecovery.owner) return;
    st.retrying = true;
    setPreviewRecovery({ ...previewRecovery, retrying: true });
    void refreshLevelPreview(previewRecovery);
  };
  const queueLevel = (next, shown) => {
    const st = levelRef.current;
    st.revision++;
    st.rowId = latest.current.selectedId;
    st.owner = levelWriteOwner();
    st.retrying = false;
    setPreviewRecovery(null);
    st.value = next; setPendingLevel(next);
    setMessage(next === FOLLOW ? 'Bleep follows the household level' : `Bleep level ${Math.round(shown * 100)}%`);
    clearTimeout(st.timer);
    st.timer = setTimeout(saveLevel, LEVEL_DEBOUNCE_MS);
  };
  const changeBleepLevel = (delta) => {
    const from = typeof levelRef.current.value === 'number' ? levelRef.current.value : bleepLevel;
    const next = clampBleepLevel(from + delta);
    queueLevel(next, next);
  };
  // Absolute value for this film, or null to follow the household level again.
  const setBleepLevel = (value) => (value == null ? queueLevel(FOLLOW, householdLevel) : queueLevel(clampBleepLevel(value), clampBleepLevel(value)));
  // The household level: shown at once, each click steps from what is shown, and the writes go through
  // the same serialised queue as the film level so they land in click order.
  const householdRef = useRef({ revision: 0 });
  const setHouseholdLevel = async (value) => {
    const next = clampBleepLevel(value);
    const st = householdRef.current;
    const revision = ++st.revision;
    setPendingHousehold(next);
    try {
      await enqueueLevelWrite(`${API}/profiles/family/settings`, levelWriteOwner(), next);
      logger.info('content_filter.review.bleep_level', { rk, scope: 'household', value: next });
    } catch (err) {
      logger.warn('content_filter.review.bleep_level_failed', { rk, scope: 'household', value: next, error: err.message });
      if (st.revision === revision) setMessage(err.message || 'The household bleep level did not save.');
    }
    if (st.revision !== revision) return;
    void refreshReview().catch(() => {}).finally(() => { if (st.revision === revision) setPendingHousehold(null); });
    void previewStore.refresh().catch(() => false);
  };
  // Leaving the film must not drop the last keypress.
  useEffect(() => () => {
    saveLevel();
  }, [saveLevel]);

  const top = undoStack[undoStack.length - 1];
  const canUndo = Boolean(top && rows?.some((r) => r.id === top.rowId));

  const handlers = {
    next: () => step(1), prev: () => step(-1), replay, togglePlay, playWithout, refine, refineAll, rework: reworkKey, helpOpen, verdict, undo, effect, settings, widen,
    cycleKind: () => setScope({ ...scope, kind: nextKind(scope.kind) }),
    bleepLevel: changeBleepLevel, setBleepLevel, setHouseholdLevel,
    retryPreview: previewRecovery ? retryPreview : null,
    help: () => setHelpOpen((v) => !v),
    timingDirty,
    escape: () => {
      if (helpOpen) { setHelpOpen(false); return true; }
      if (dirtyTiming.current) {
        const drop = dirtyTiming.current; dirtyTiming.current = null; drop();
        logger.info('content_filter.review.unsaved_timing_dropped', { rk, rowId: latest.current.selectedId });
        setMessage('Timing change dropped.');
        return true;
      }
      return false;
    },
  };
  return {
    scope, setScope, setStage, stages, scoped, row, pick, handlers, message: saving ? 'Saving…' : message, helpOpen, canUndo, tally, pendingRefine, refining, running,
    roughRefineCount: roughRefineTargets.length, roughLeftCount, refineAllCount: refineTargets.length,
    bleepLevel, bleep: { household: householdLevel, film: filmLevel, effective: bleepLevel }, flagged: flagged.length, rework,
    previewRecovery: previewRecovery ? {
      message: previewRecovery.saved ? 'Bleep level saved. The preview could not refresh.' : 'The preview could not refresh.',
      retry: retryPreview, retrying: Boolean(previewRecovery.retrying),
    } : null,
  };
}

export default useReviewStation;
