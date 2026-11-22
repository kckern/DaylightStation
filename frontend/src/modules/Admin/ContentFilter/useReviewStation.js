import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getToken } from '../../../lib/auth.js';
import { invalidateApiResources } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/index.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { DEFAULT_SCOPE, WIDEN_STEP, actionKeysFor, hasVerdict, isOpen, isSceneRow, keysKindOf, nextKind, plays, rowAction, scopeRows, stepFrom } from './reviewScope.js';
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
// A held [ or ] changes the level many times a second; the film's setting is written once it settles.
const LEVEL_DEBOUNCE_MS = 400;
const REWORK_ARM_MS = 4000;
const levelWrites = new Map();

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

export function useReviewStation({ ratingKey, data, reload, refreshReview, selected, select, activeView, runBusy = false }) {
  const rk = String(ratingKey);
  const rows = data?.rows;
  const [scope, setScopeState] = useState(DEFAULT_SCOPE);
  const [message, setMessage] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const arrived = useRef({ id: null, at: Date.now(), replays: 0 });
  const via = useRef('click');
  const latest = useRef({});
  latest.current = { rows, selectedId: selected?.id ?? null, scoped: null, scope };

  const scoped = useMemo(() => scopeRows(rows, scope), [rows, scope]);
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

  const go = useCallback((r, how) => {
    if (!r) return;
    via.current = how;
    setMessage(null);
    select(r);
    previewStore.jumpToCue({ in: r.in });
  }, [select]);
  // Every cursor move seeks to in - PREVIEW_LEAD_SEC (jumpToCue): click, timeline, keys, auto-advance.
  const pick = useCallback((r, { seek = true } = {}) => {
    via.current = 'click'; setMessage(null); select(r);
    if (seek) previewStore.jumpToCue({ in: r.in });
  }, [select]);
  const setScope = useCallback((next) => {
    setScopeState(next);
    setMessage(null);
    logger.info('content_filter.review.scope', { rk, show: next.show, order: next.order, timing: next.timing, kind: next.kind, action: next.action, needs: next.needs, group: next.group, shown: scopeRows(latest.current.rows, next).length });
  }, [rk]);

  const step = (dir) => {
    const next = stepFrom(scoped, selected?.id, dir);
    if (next) go(next, 'key'); else setMessage(dir > 0 ? 'That is the last part in this view.' : 'That is the first part in this view.');
  };

  // Runs when a save lands: read the CURRENT scope/rows, and leave a cursor the user moved meanwhile.
  const advance = (from) => {
    if (latest.current.selectedId !== from.id) return;
    const list = latest.current.scoped || [];
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

  const verdict = (v, reason) => { if (row) guarded('verdict', () => record(row, v, { reason })); };

  const callsFor = (r, body) => {
    const base = `${API}/${encodeURIComponent(rk)}`;
    if (isSceneRow(r)) return [[`${base}/scenes/${encodeURIComponent(r.peekId)}`, body, 'PUT']];
    const members = r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : []);
    return members.map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']);
  };

  const effect = (letter) => {
    if (!row) return;
    const entry = actionKeysFor(keysKindOf(row)).find(([k]) => k.toLowerCase() === letter);
    if (!entry) return;
    const [, label, to] = entry;
    guarded('effect', async () => {
      const allowed = isSceneRow(row) ? SCENE_EFFECTS.has(to) : effectChoices(row.modality).some((o) => o.value === to);
      if (!allowed) { setMessage(`${label} does not fit this part.`); return; }
      if (rowAction(row) === rowAction({ effect: to })) { setMessage(`Already ${label.toLowerCase()}.`); return; }
      for (const [path, body, method] of callsFor(row, { effect: to })) await DaylightAPI(path, body, method);
      await record(row, 'approve', { change: { from: row.effect, to } });
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
    const last = undoStack[undoStack.length - 1];
    if (!last) { setMessage('Nothing to undo.'); return; }
    setUndoStack((s) => s.slice(0, -1));
    const target = latest.current.rows?.find((r) => r.id === last.rowId);
    // A remove is terminal once the re-audit lands: the row is gone and so is its verdict.
    if (!target) { setMessage('That part is already gone; it cannot be undone.'); return; }
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/review/${encodeURIComponent(last.rowId)}`, {}, 'DELETE');
    logger.info('content_filter.review.undo', { rk, rowId: last.rowId, undid: last.verdict });
    if (!activeView.current) return;
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

  // Refine: one part (R) or every filtered part still on rough timing (Shift+R), as one send-back
  // of their member cues (owner, 2026-11-21: refine the flagged ones, never the 136 that play).
  // One run per film: presses while a run is open collect here and go out when it closes.
  const [pendingRefine, setPendingRefine] = useState(() => new Set());
  const cuesOf = (r) => (isSceneRow(r) ? [] : (r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : [])));
  const sendRefine = async (cues, what) => {
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/jobs`, { kind: 'send-back', cues }, 'POST');
    logger.info('content_filter.review.refine', { rk, cues: cues.length, what });
    if (!activeView.current) return;
    setMessage(`Refining ${what}. You can keep reviewing.`);
    reload();
  };
  const queueRefine = (cues, what) => {
    if (!cues.length) { setMessage('Nothing to refine there.'); return; }
    if (runBusy) {
      setPendingRefine((s) => new Set([...s, ...cues]));
      logger.info('content_filter.review.refine_queued', { rk, cues: cues.length, what });
      setMessage(`Queued: ${what} refines when the current run finishes.`);
      return;
    }
    guarded('refine', () => sendRefine(cues, what));
  };
  const refine = () => {
    if (!row) return;
    if (isSceneRow(row)) { setMessage('A scene is rebuilt with its parts; refine the parts in it.'); return; }
    queueRefine(cuesOf(row), `"${row.label}"`);
  };
  const refineAll = ({ again = false } = {}) => {
    const targets = (rows || []).filter((r) => !plays(r) && !isSceneRow(r) && (again || r.timing !== 'refined'));
    const cues = [...new Set(targets.flatMap(cuesOf))];
    queueRefine(cues, `${targets.length} filtered part${targets.length === 1 ? '' : 's'}`);
  };
  // Flush the queued refines once the film's run closes.
  const wasBusy = useRef(runBusy);
  useEffect(() => {
    const was = wasBusy.current; wasBusy.current = runBusy;
    if (!was || runBusy || !pendingRefine.size) return;
    const cues = [...pendingRefine];
    setPendingRefine(new Set());
    guarded('refine', () => sendRefine(cues, `${cues.length} queued part${cues.length === 1 ? '' : 's'}`));
  }, [runBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bleep level for this film: film ?? household ?? 0.25. The key moves a pending value at once
  // (shown in the key bar); one debounced write saves it, then the player re-reads its profile and
  // the cue replays so the reviewer hears the change.
  const [pendingLevel, setPendingLevel] = useState(null);
  const [previewRecovery, setPreviewRecovery] = useState(null);
  const levelRef = useRef({ value: null, rowId: null, owner: null, timer: null, revision: 0, retrying: false });
  const savedLevel = data?.bleepLevel?.film ?? data?.bleepLevel?.profile ?? BLEEP_LEVEL_DEFAULT;
  const bleepLevel = pendingLevel ?? savedLevel;
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
    const { value, revision, rowId, owner } = st;
    if (value == null) return;
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
      logger.info('content_filter.review.bleep_level', { rk, level: value });
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
  const changeBleepLevel = (delta) => {
    const st = levelRef.current;
    const from = st.value ?? bleepLevel;
    const next = clampBleepLevel(from + delta);
    st.revision++;
    st.rowId = latest.current.selectedId;
    st.owner = levelWriteOwner();
    st.retrying = false;
    setPreviewRecovery(null);
    st.value = next; setPendingLevel(next);
    setMessage(`Bleep level ${Math.round(next * 100)}%`);
    clearTimeout(st.timer);
    st.timer = setTimeout(saveLevel, LEVEL_DEBOUNCE_MS);
  };
  // Leaving the film must not drop the last keypress.
  useEffect(() => () => {
    saveLevel();
  }, [saveLevel]);

  const top = undoStack[undoStack.length - 1];
  const canUndo = Boolean(top && rows?.some((r) => r.id === top.rowId));
  // The tally counts the parts that need a verdict: the filtered ones (parts that play need none).
  const tally = useMemo(() => {
    const filtered = (rows || []).filter((r) => !plays(r));
    return { done: filtered.filter(hasVerdict).length, total: filtered.length, redo: (rows || []).filter((r) => r.verdict?.verdict === 'redo').length };
  }, [rows]);

  const handlers = {
    next: () => step(1), prev: () => step(-1), replay, togglePlay, playWithout, refine, refineAll, rework: reworkKey, helpOpen, verdict, undo, effect, widen,
    cycleKind: () => setScope({ ...scope, kind: nextKind(scope.kind) }),
    bleepLevel: changeBleepLevel,
    retryPreview: previewRecovery ? retryPreview : null,
    help: () => setHelpOpen((v) => !v),
    escape: () => { if (helpOpen) { setHelpOpen(false); return true; } return false; },
  };
  return {
    scope, setScope, scoped, row, pick, handlers, message: saving ? 'Saving…' : message, helpOpen, canUndo, tally, pendingRefine,
    bleepLevel, flagged: flagged.length, rework,
    previewRecovery: previewRecovery ? {
      message: previewRecovery.saved ? 'Bleep level saved. The preview could not refresh.' : 'The preview could not refresh.',
      retry: retryPreview, retrying: Boolean(previewRecovery.retrying),
    } : null,
  };
}

export default useReviewStation;
