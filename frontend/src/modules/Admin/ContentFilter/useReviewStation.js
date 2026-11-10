import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { previewStore } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { DEFAULT_SCOPE, WIDEN_STEP, actionKeysFor, hasVerdict, nextKind, rowAction, scopeRows, stepFrom } from './reviewScope.js';
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
const SCENE_EFFECTS = new Set(['skip', 'blackout']);
// A held [ or ] changes the level many times a second; the film's setting is written once it settles.
const LEVEL_DEBOUNCE_MS = 400;

export function useReviewStation({ ratingKey, data, reload, selected, select, runBusy = false }) {
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
  latest.current = { rows, selectedId: selected?.id ?? null, scoped: null };

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
  // A different film starts a fresh undo history.
  useEffect(() => { setUndoStack([]); }, [rk]);

  const setScope = useCallback((next) => {
    setScopeState(next);
    setMessage(null);
    logger.info('content_filter.review.scope', { rk, kind: next.kind, action: next.action, needs: next.needs, group: next.group, shown: scopeRows(latest.current.rows, next).length });
  }, [rk]);

  const step = (dir) => {
    const next = stepFrom(scoped, selected?.id, dir);
    if (next) go(next, 'key'); else setMessage(dir > 0 ? 'That is the last part in this view.' : 'That is the first part in this view.');
  };

  // Runs when a save lands: read the CURRENT scope/rows, and leave a cursor the user moved meanwhile.
  const advance = (from) => {
    if (latest.current.selectedId !== from.id) return;
    const list = latest.current.scoped || [];
    const next = stepFrom(list, from.id, 1, { onlyOpen: true });
    if (next) { go(next, 'auto'); return; }
    const open = list.filter((r) => r.id !== from.id && !hasVerdict(r)).length;
    setMessage(open ? `End of this view. ${open} still open above.` : `All ${list.length} in this view reviewed.`);
  };

  const guarded = async (key, fn) => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try { await fn(); } catch (err) {
      logger.warn('content_filter.review.action_failed', { rk, rowId: selected?.id, key, error: err.message });
      setMessage(err.message || 'That did not work.');
    } finally { busy.current = false; setSaving(false); }
  };

  const record = async (r, verdict, { reason, change } = {}) => {
    const dwellMs = Date.now() - arrived.current.at;
    const replays = arrived.current.replays;
    await DaylightAPI(`${API}/${encodeURIComponent(rk)}/review/${encodeURIComponent(r.id)}`,
      { span: [r.in, r.out], verdict, ...(reason ? { reason } : {}), ...(change ? { change } : {}), dwellMs, replays }, 'PUT');
    logger.info('content_filter.review.verdict', { rk, rowId: r.id, kind: r.kind, category: r.group, effect: r.effect, verdict, ...(reason ? { reason } : {}), ...(change ? { change } : {}), dwellMs, replays });
    setUndoStack((s) => [...s, { rowId: r.id, verdict, changed: Boolean(change) }]);
    reload();
    advance(r);
  };

  const verdict = (v, reason) => { if (row) guarded('verdict', () => record(row, v, { reason })); };

  const callsFor = (r, body) => {
    const base = `${API}/${encodeURIComponent(rk)}`;
    if (r.kind === 'scenes') return [[`${base}/scenes/${encodeURIComponent(r.peekId)}`, body, 'PUT']];
    const members = r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : []);
    return members.map((id) => [`${base}/cues/${encodeURIComponent(id)}`, body, 'PUT']);
  };

  const effect = (letter) => {
    if (!row) return;
    const entry = actionKeysFor(row.kind).find(([k]) => k.toLowerCase() === letter);
    if (!entry) return;
    const [, label, to] = entry;
    guarded('effect', async () => {
      const allowed = row.kind === 'scenes' ? SCENE_EFFECTS.has(to) : effectChoices(row.modality).some((o) => o.value === to);
      if (!allowed) { setMessage(`${label} does not fit this part.`); return; }
      if (rowAction(row) === rowAction({ effect: to })) { setMessage(`Already ${label.toLowerCase()}.`); return; }
      for (const [path, body, method] of callsFor(row, { effect: to })) await DaylightAPI(path, body, method);
      await record(row, 'approve', { change: { from: row.effect, to } });
    });
  };

  const widen = () => {
    if (!row) return;
    guarded('widen', async () => {
      const single = row.kind === 'scenes' || (row.members ?? [row.peekId]).length === 1;
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
      const cues = [...new Set(flagged.flatMap((r) => (r.kind === 'scenes' ? [] : (r.members ?? (String(r.id).startsWith('cue:') ? [r.peekId] : [])))))];
      const reasons = Object.fromEntries(flagged.filter((r) => r.verdict.reason).map((r) => [r.id, r.verdict.reason]));
      const body = cues.length ? { kind: 'send-back', cues, reasons } : { kind: 'stage', stage: 'scenes', reasons };
      await DaylightAPI(`${API}/${encodeURIComponent(rk)}/jobs`, body, 'POST');
      logger.info('content_filter.review.rework', { rk, rows: flagged.length, cues: cues.length, kind: body.kind, reasons: Object.keys(reasons).length });
      const sceneRows = flagged.filter((r) => r.kind === 'scenes').length;
      setMessage(cues.length && sceneRows ? `Sent ${flagged.length - sceneRows} back. ${sceneRows} scene part${sceneRows === 1 ? '' : 's'} stay flagged for the next run.` : `Sent ${flagged.length} back to the pipeline.`);
      reload();
    });
  };

  const replay = () => {
    if (!row) return;
    arrived.current.replays += 1;
    previewStore.jumpToCue({ in: row.in });
  };

  // Bleep level for this film: film ?? household ?? 0.25. The key moves a pending value at once
  // (shown in the key bar); one debounced write saves it, then the player re-reads its profile and
  // the cue replays so the reviewer hears the change.
  const [pendingLevel, setPendingLevel] = useState(null);
  const levelRef = useRef({ value: null, timer: null });
  const savedLevel = data?.bleepLevel?.film ?? data?.bleepLevel?.profile ?? BLEEP_LEVEL_DEFAULT;
  const bleepLevel = pendingLevel ?? savedLevel;
  const saveLevel = useCallback(async () => {
    const st = levelRef.current;
    clearTimeout(st.timer); st.timer = null;
    const value = st.value;
    if (value == null) return;
    try {
      await DaylightAPI(`${API}/${encodeURIComponent(rk)}/settings`, { settings: { bleepLevel: value } }, 'PUT');
      logger.info('content_filter.review.bleep_level', { rk, level: value });
      await previewStore.refresh();
      reload();
      const r = latest.current.rows?.find((x) => x.id === latest.current.selectedId);
      if (r) previewStore.jumpToCue({ in: r.in });
    } catch (err) {
      logger.warn('content_filter.review.bleep_level_failed', { rk, level: value, error: err.message });
      setMessage(err.message || 'The bleep level did not save.');
    } finally {
      if (st.value === value) { st.value = null; setPendingLevel(null); }
    }
  }, [rk, reload]);
  const changeBleepLevel = (delta) => {
    const st = levelRef.current;
    const from = st.value ?? latest.current.savedLevel;
    const next = clampBleepLevel(from + delta);
    st.value = next; setPendingLevel(next);
    setMessage(`Bleep level ${Math.round(next * 100)}%`);
    clearTimeout(st.timer);
    st.timer = setTimeout(saveLevel, LEVEL_DEBOUNCE_MS);
  };
  latest.current.savedLevel = savedLevel;
  // Leaving the film must not drop the last keypress.
  useEffect(() => () => { if (levelRef.current.value != null) saveLevel(); }, [saveLevel]);

  const top = undoStack[undoStack.length - 1];
  const canUndo = Boolean(top && rows?.some((r) => r.id === top.rowId));
  const tally = useMemo(() => ({
    done: (rows || []).filter(hasVerdict).length, total: rows?.length || 0,
    redo: (rows || []).filter((r) => r.verdict?.verdict === 'redo').length,
  }), [rows]);

  const handlers = {
    next: () => step(1), prev: () => step(-1), replay, rework, verdict, undo, effect, widen,
    cycleKind: () => setScope({ ...scope, kind: nextKind(scope.kind) }),
    bleepLevel: changeBleepLevel,
    help: () => setHelpOpen((v) => !v),
    escape: () => { if (helpOpen) { setHelpOpen(false); return true; } return false; },
  };
  return { scope, setScope, scoped, row, pick, handlers, message: saving ? 'Saving…' : message, helpOpen, canUndo, tally, bleepLevel, flagged: flagged.length, rework };
}

export default useReviewStation;
