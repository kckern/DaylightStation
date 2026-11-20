import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Group, List, Modal, Skeleton, Stack, Text, Title } from '@mantine/core';
import {
  IconAlertTriangle, IconArrowBackUp, IconCheck, IconChevronLeft, IconDeviceFloppy, IconPencil, IconPhoto, IconRefresh, IconSparkles, IconX,
} from '@tabler/icons-react';
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import { DaylightAPI, DaylightAPIText } from "../../../../../frontend/src/lib/api.mjs";
import { osmdRender, buildMeasures, extractMeasureBounds, extractMeasureMap, extractPerStaffGeometry } from "../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js";
import { parseMusicXml } from "../../../../../__capabilities/music-notation/browser/parseMusicXml.js";
import { errors as editorErrors, idForIndex, initSegmentEditor, segmentEditorReducer, uncoveredBars } from "./segmentEditor.js";
import { fillParts, generatedSegments, householdOverridesSegments } from "./scorePlan.js";
import MeasureStrip, { SEGMENT_COLORS, barsLabel, segmentLabel } from "./MeasureStrip.jsx";
import ApproveDialog, { ADMIN_PATH, scoreQuery } from "./ApproveDialog.jsx";
import { cutsKey, firstTimeSig, proposeSegments, proposalTargetLen, quartersPerMeasure } from "./proposeSegments.js";
import { POSTER_ERROR_MESSAGES, posterFromEngraving, uploadPoster } from "./posterJob.js";
import "./SheetMusicScore.scss";

const LIBRARY_ROUTE = '/admin/content/sheet-music';
const PIANO_CONFIG_PATH = 'api/v1/admin/apps/piano/config';
const ENGRAVE_SCALE = 0.8;

/** Readable copy for segment validation codes (segmentEditor errors + server 422s). */
export const SEGMENT_ERROR_MESSAGES = {
  'missing-id': 'has no id',
  'duplicate-id': 'shares its id with another segment',
  'not-integer': 'has bars that are not whole positions',
  reversed: 'ends before it starts',
  'out-of-range': 'runs past the last bar of this score',
  overlap: 'overlaps another segment',
  'no-notes': 'has no notes for the kiosk to play',
};
export const FORM_ERROR_MESSAGES = {
  empty: 'Add at least one segment before saving.',
  'bad-measure-count': 'The score has no bars to segment.',
  'not-array': 'The segments could not be read.',
  'no-notes': 'A segment has no notes for the kiosk to play. Move its edges or remove it.',
};

const errorCode = (err) => (typeof err?.body?.error === 'string' ? err.body.error : null);
/** Segment identity for "has this changed": ids, bars and names; parts are derived. */
const segmentsKey = (segments) => JSON.stringify((segments || []).map(({ id, start, end, name }) => [id, start, end, name ?? null]));

/** True when any stored segment's `parts` differ from the kiosk's for the same id. */
export function partsDrift(stored, filled) {
  if (!Array.isArray(filled)) return true;
  const want = new Map(filled.map((s) => [s.id, JSON.stringify(s.parts || [])]));
  return (stored || []).some((s) => want.get(s.id) !== JSON.stringify(s.parts || []));
}

/**
 * The proposal to save with a draft. A proposal saved as proposed keeps its scorer;
 * once its cuts are changed by hand (renames do not count) it is kept with
 * `edited: true`, features and all, so calibration can tell it from both a
 * scorer's own cut and a hand-made one. With no proposal, a draft is 'manual'.
 */
export function draftProposal({ pending, stored, storedSegments, segments, dirty }) {
  if (pending) return cutsKey(segments) === pending.key ? pending.proposal : { ...pending.proposal, edited: true };
  if (stored && typeof stored === 'object' && stored.scorer && stored.scorer !== 'manual') {
    return cutsKey(segments) === cutsKey(storedSegments) ? stored : { ...stored, edited: true };
  }
  if (stored && !dirty) return stored;
  return { scorer: 'manual', at: new Date().toISOString() };
}

/**
 * True when the stored draft's proposal was computed on the score as it is now:
 * its `contentSha256` matches, or (older drafts without one) the approved
 * segments are not stale.
 */
export function storedProposalCurrent(learn) {
  const proposal = learn?.draft?.proposal;
  if (!proposal || typeof proposal !== 'object') return false;
  if (typeof proposal.contentSha256 === 'string') return proposal.contentSha256 === learn.currentSha256;
  return !learn.stale;
}

function pageReducer(state, action) {
  if (action?.type === 'load') return initSegmentEditor({ segments: action.segments, measureCount: action.measureCount });
  return segmentEditorReducer(state, action);
}

function describeError(e) {
  if (e.index === -1) return FORM_ERROR_MESSAGES[e.code] || `The segments are not valid (${e.code}).`;
  // Errors index the sorted segment list, so the position is what a grown-up sees.
  const who = `Segment ${e.index + 1}`;
  return `${who} ${SEGMENT_ERROR_MESSAGES[e.code] || `is not valid (${e.code})`}.`;
}

/**
 * Tinted boxes over the engraving, one per layout measure, coloured per segment.
 * A layout position maps to its engraved bar through `measures[i].index` (the source
 * measure), which differs from `i` when an all-rest bar has no onsets or a repeat
 * plays a bar twice. A repeated bar's positions share one engraved bar, so their
 * boxes stack on the same spot.
 */
function SegmentOverlay({ segments, measures, bounds, variant }) {
  const boxes = [];
  segments.forEach((s, index) => {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) return;
    for (let i = Math.max(s.start, 0); i <= Math.min(s.end, measures.length - 1); i += 1) {
      const b = bounds[measures[i]?.index];
      if (!b) continue;
      boxes.push(
        <div
          key={`${variant}-${s.id}-${i}`}
          className={`sm-score__box sm-score__box--${variant} sm-seg-c${index % SEGMENT_COLORS}`}
          style={{ left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top }}
        >
          {i === s.start ? <span className="sm-score__box-label">{segmentLabel(s, index)}</span> : null}
        </div>,
      );
    }
  });
  return <>{boxes}</>;
}

/**
 * One score's admin page: engraves the score with the kiosk's own renderer and
 * indexing, overlays its Learn segments, and edits, saves and approves a draft.
 * The splat holds the full content id.
 */
export default function SheetMusicScore() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-sheet-music' }), []);
  const params = useParams();
  const id = params['*'] || '';
  const localId = useMemo(() => id.replace(/^[a-z]+:/i, ''), [id]);

  const [xml, setXml] = useState(null);
  const [xmlError, setXmlError] = useState(null);
  const [learn, setLearn] = useState(null);
  const [learnError, setLearnError] = useState(null);
  const [pianoConfig, setPianoConfig] = useState(undefined); // undefined = loading, null = none
  const [engraved, setEngraved] = useState(null);
  const [engraveError, setEngraveError] = useState(null);
  const [editor, dispatch] = useReducer(pageReducer, null, () => initSegmentEditor({ segments: [], measureCount: 0 }));
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [serverErrors, setServerErrors] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The unsaved proposal behind the editor's segments: { proposal, key } where key is
  // the segmentsKey it produced, so Save draft can tell an edited proposal apart.
  const [pending, setPending] = useState(null);
  // A proposal waiting on "replace your current segments?" ({ segments, proposal, ms }).
  const [confirmPropose, setConfirmPropose] = useState(null);
  // Set once a poster is generated here; kept apart from `learn` so saving a poster
  // does not reload the editor and drop unsaved segment edits.
  const [posterSaved, setPosterSaved] = useState(null);
  // segmentsKey of what Edit loaded, to tell whether an unsaved start was changed.
  const [editStart, setEditStart] = useState(null);
  const hostRef = useRef(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { logger.info('admin.sheetmusic.score-mounted', { id }); }, [logger, id]);

  const loadLearn = useCallback(async () => {
    try {
      const file = await DaylightAPI(`${ADMIN_PATH}/learn${scoreQuery(id)}`);
      if (!alive.current) return;
      setLearnError(null);
      setLearn(file && typeof file === 'object' ? file : {});
    } catch (err) {
      if (!alive.current) return;
      logger.error('admin.sheetmusic.learn-load-failed', { id, code: errorCode(err), status: err?.status ?? null });
      setLearnError(errorCode(err) === 'SCORE_NOT_FOUND' ? 'This score is not in the library any more.' : 'The Learn file could not be loaded.');
    }
  }, [id, logger]);

  // XML, Learn file and household config in parallel.
  useEffect(() => {
    let cancelled = false;
    setXml(null); setXmlError(null); setLearn(null); setLearnError(null); setEngraved(null); setEngraveError(null);
    setPosterSaved(null);
    (async () => {
      try {
        const text = await DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localId)}`);
        if (!cancelled) setXml(text);
      } catch (err) {
        if (cancelled) return;
        logger.error('admin.sheetmusic.xml-load-failed', { id, error: err?.message });
        setXmlError('The score file could not be loaded.');
      }
    })();
    loadLearn();
    (async () => {
      try {
        const res = await DaylightAPI(PIANO_CONFIG_PATH);
        if (!cancelled) setPianoConfig(res?.parsed ?? null);
      } catch (err) {
        if (cancelled) return;
        logger.warn('admin.sheetmusic.config-load-failed', { error: err?.message });
        setPianoConfig(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id, localId, loadLearn, logger, reloadKey]);

  // Engrave with the kiosk's renderer; positions come from its cursor walk.
  useEffect(() => {
    if (!xml || !hostRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const host = hostRef.current;
        const width = host.parentElement?.clientWidth || 0;
        const result = await osmdRender(host, xml, {
          flow: 'wrapped', scale: ENGRAVE_SCALE, ...(width > 0 ? { width } : {}), shouldAbort: () => cancelled,
        });
        if (cancelled || !result) return;
        const measures = buildMeasures(result.steps);
        const bounds = extractMeasureBounds(result.osmd);
        let parsed = null;
        try { parsed = parseMusicXml(xml); } catch { parsed = null; }
        setEngraved({
          measures, bounds, steps: result.steps || [], sections: parsed?.sections || [],
          tempoMap: result.tempoEntries || [], tempo: parsed?.tempo, width: result.width, height: result.height,
          beatsPerMeasure: quartersPerMeasure(firstTimeSig(parsed)),
          measureMap: extractMeasureMap(result.osmd),
          staffBoxes: extractPerStaffGeometry(result.osmd),
        });
        logger.info('admin.sheetmusic.engraved', { id, measures: measures.length });
      } catch (err) {
        if (cancelled) return;
        logger.error('admin.sheetmusic.engrave-failed', { id, error: err?.message });
        setEngraveError('The score could not be engraved.');
      }
    })();
    return () => { cancelled = true; };
  }, [xml, id, logger]);

  const measures = engraved?.measures || [];
  const measureCount = measures.length;
  const score = useMemo(() => (engraved ? {
    id, measures: engraved.measures, steps: engraved.steps, sections: engraved.sections,
    tempoMap: engraved.tempoMap, tempo: engraved.tempo,
  } : null), [engraved, id]);

  const generated = useMemo(() => {
    if (!score || pianoConfig === undefined) return null;
    try { return generatedSegments({ score, pianoConfig, scoreId: id }); } catch (err) {
      logger.warn('admin.sheetmusic.generate-failed', { id, error: err?.message });
      return null;
    }
  }, [score, pianoConfig, id, logger]);

  // The editor follows the stored draft whenever the Learn file (re)loads.
  useEffect(() => {
    if (!learn || !engraved) return;
    const draft = learn.draft?.segments;
    if (Array.isArray(draft)) {
      const loaded = initSegmentEditor({ segments: draft, measureCount: engraved.measures.length });
      dispatch({ type: 'load', segments: loaded.segments, measureCount: engraved.measures.length });
      setBaseline(segmentsKey(loaded.segments));
      setEditing(true);
    } else {
      dispatch({ type: 'load', segments: [], measureCount: engraved.measures.length });
      setBaseline(null);
      setEditing(false);
    }
    setSelectedId(null);
    setServerErrors(null);
    setPending(null);
    setConfirmPropose(null);
  }, [learn, engraved]);

  const approved = Array.isArray(learn?.segments) ? learn.segments : [];
  const hasApproved = approved.length > 0;
  const hasDraft = Boolean(learn?.draft);
  // An unsaved proposal counts as a change even when its cuts match the draft, so
  // Approve saves it (with its proposal) before reviewing.
  const dirty = editing && (Boolean(pending) || baseline === null || segmentsKey(editor.segments) !== baseline);

  const validation = useMemo(() => (editing ? editorErrors(editor) : []), [editing, editor]);
  const parts = useMemo(() => {
    if (!editing || validation.length || !score) return null;
    return fillParts(editor.segments, score);
  }, [editing, validation, editor, score]);
  const partErrors = parts && !parts.segments
    ? (parts.missing.length ? parts.missing.map((sid) => ({ code: 'no-notes', id: sid, index: editor.segments.findIndex((s) => s.id === sid) }))
      : [{ code: 'no-notes', id: null, index: -1 }])
    : [];
  const allErrors = [...validation, ...partErrors];
  const formErrors = allErrors.filter((e) => e.index === -1);
  const segmentErrors = allErrors.filter((e) => e.index !== -1);
  const uncovered = editing ? uncoveredBars(editor) : [];
  const canWrite = editing && allErrors.length === 0 && Boolean(parts?.segments) && !busy;

  const hasGenerated = Boolean(generated?.length);
  const pieceOverride = useMemo(() => householdOverridesSegments(pianoConfig, id), [pianoConfig, id]);

  const startEdit = () => {
    // Generated ids (`m0-3`) describe bars, which stop being true once edited; a
    // draft starts from a, b, c like any hand-made one.
    const source = hasApproved ? approved
      : (generated || []).map((s, i) => ({ ...s, id: idForIndex(i) }));
    dispatch({ type: 'load', segments: source, measureCount });
    setBaseline(null);
    setEditStart(segmentsKey(initSegmentEditor({ segments: source, measureCount }).segments));
    setEditing(true);
    setSelectedId(null);
    setNotice(null);
    logger.info('admin.sheetmusic.edit-started', { id, from: hasApproved ? 'approved' : 'generated', segments: source.length });
  };

  const applyProposal = ({ segments, proposal, ms }, replacedEdits) => {
    if (editing) dispatch({ type: 'replace', segments });
    else {
      dispatch({ type: 'load', segments, measureCount });
      setBaseline(null);
    }
    setEditing(true);
    setSelectedId(null);
    setNotice(null);
    setServerErrors(null);
    setConfirmPropose(null);
    setPending({ proposal, key: cutsKey(segments) });
    logger.info('admin.sheetmusic.propose', { id, scorer: proposal.scorer, segments: segments.length, ms, replacedEdits });
  };

  const onPropose = () => {
    if (!engraved || !measureCount) return;
    const t0 = performance.now();
    const result = proposeSegments(
      {
        measures, steps: engraved.steps, sections: engraved.sections,
        beatsPerMeasure: engraved.beatsPerMeasure, measureMap: engraved.measureMap,
      },
      { targetLen: proposalTargetLen(pianoConfig) },
    );
    const next = {
      ...result,
      proposal: { ...result.proposal, ...(learn?.currentSha256 ? { contentSha256: learn.currentSha256 } : {}) },
      ms: Math.round(performance.now() - t0),
    };
    // Ask before overwriting unsaved edits, or a stored draft the proposal would change.
    const changedHere = pending
      ? cutsKey(editor.segments) !== pending.key
      : segmentsKey(editor.segments) !== (baseline ?? editStart);
    const storedDiffers = !pending && hasDraft && cutsKey(learn.draft.segments) !== cutsKey(result.segments);
    if (editing && (changedHere || storedDiffers)) {
      setConfirmPropose(next);
      return;
    }
    applyProposal(next, false);
  };

  const discard = () => {
    setPending(null);
    setConfirmPropose(null);
    setNotice(null);
    setServerErrors(null);
    if (hasDraft) {
      dispatch({ type: 'load', segments: learn.draft.segments, measureCount });
    } else {
      setEditing(false);
      dispatch({ type: 'load', segments: [], measureCount });
    }
    setSelectedId(null);
  };

  const handleWriteError = (err, action) => {
    const code = errorCode(err);
    logger.warn('admin.sheetmusic.save-failed', { id, action, code, status: err?.status ?? null });
    if (code === 'invalid-segments') {
      setServerErrors(Array.isArray(err.body?.errors) ? err.body.errors : []);
      return;
    }
    if (code === 'draft-changed' || code === 'no-draft') {
      setNotice({ color: 'yellow', text: 'The draft changed in another tab. It has been reloaded; review it and try again.' });
      loadLearn();
      return;
    }
    setNotice({ color: 'red', text: `The draft did not save${code ? ` (${code})` : ''}. Try again.` });
  };

  /** Saves the editor as the draft, hands filled in; resolves the new draftRevision or null. */
  const saveDraft = async () => {
    if (!canWrite) return null;
    const proposal = draftProposal({
      pending, stored: learn?.draft?.proposal, storedSegments: learn?.draft?.segments, segments: editor.segments, dirty,
    });
    setBusy('save');
    setServerErrors(null);
    setNotice(null);
    try {
      const res = await DaylightAPI(`${ADMIN_PATH}/learn${scoreQuery(id)}`, {
        action: 'draft', segments: parts.segments, proposal, measureCount,
      }, 'PUT');
      logger.info('admin.sheetmusic.draft-saved', { id, segments: parts.segments.length, draftRevision: res?.draftRevision ?? null });
      await loadLearn();
      return res?.draftRevision ?? null;
    } catch (err) {
      handleWriteError(err, 'draft');
      return null;
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const onSave = async () => {
    const revision = await saveDraft();
    if (revision) setNotice({ color: 'teal', text: 'Draft saved. The kiosk still plays the approved segments until you approve.' });
  };

  // Approve reviews what is on disk: an unchanged stored draft whose hands match what
  // the kiosk computes now goes straight to the impact. Edits, or parts that drifted
  // (a draft written elsewhere, or the XML changed under the same bar count), are
  // saved first so the server's strip and Polish agree with the kiosk.
  const onApprove = async () => {
    if (hasDraft && !dirty && !partsDrift(learn.draft.segments, parts?.segments)) { setDialog('approve'); return; }
    const revision = await saveDraft();
    if (revision) setDialog('approve');
  };

  const posterKind = posterSaved || learn?.poster || 'none';
  const onGeneratePoster = async () => {
    if (!engraved || busy || posterKind === 'scan') return;
    setBusy('poster');
    setNotice(null);
    try {
      let poster;
      try {
        poster = posterFromEngraving({ svg: hostRef.current?.querySelector('svg'), staffBoxes: engraved.staffBoxes });
      } catch (err) {
        logger.warn('admin.sheetmusic.poster-failed', { id, code: err?.code ?? null, error: err?.message });
        setNotice({ color: 'red', text: POSTER_ERROR_MESSAGES[err?.code] || `The poster could not be made (${err?.code || 'error'}).` });
        return;
      }
      const outcome = await uploadPoster(id, poster.text);
      if (!alive.current) return;
      if (!outcome.ok) {
        logger.warn('admin.sheetmusic.poster-failed', { id, code: outcome.code, status: outcome.status });
        setNotice({ color: 'red', text: POSTER_ERROR_MESSAGES[outcome.code] || `The poster did not save${outcome.code ? ` (${outcome.code})` : ''}.` });
        return;
      }
      logger.info('admin.sheetmusic.poster-generated', { id, bytes: poster.bytes });
      setPosterSaved('generated');
      setNotice({ color: 'teal', text: 'Poster saved. The kiosk shows it while this score loads and on the home desk.' });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const onDialogDone = (mode, result) => {
    setDialog(null);
    if (mode === 'approve') {
      const orphaned = (result?.impact || []).reduce((sum, row) => sum + (row.orphaned?.length || 0), 0);
      logger.info('admin.sheetmusic.approved', { id, orphaned, segments: result?.file?.segments?.length ?? null });
      setNotice({ color: 'green', text: 'Approved. The kiosk plays these segments from the next time the score opens.' });
    } else {
      logger.info('admin.sheetmusic.reverted', { id, changed: result?.changed ?? null });
      setNotice({ color: 'green', text: 'Reverted. The kiosk cuts this score itself again.' });
    }
    loadLearn();
  };

  const onDraftChanged = () => {
    setDialog(null);
    setNotice({ color: 'yellow', text: 'The draft changed in another tab. It has been reloaded; review it and approve again.' });
    loadLearn();
  };

  const loadFailed = xmlError || learnError || engraveError;
  const ready = Boolean(engraved && learn);
  const viewSegments = hasApproved ? approved : (generated || []);
  const viewTitle = !hasApproved ? 'Generated segments (what the kiosk plays now)'
    : learn?.stale ? 'Approved segments (stale: the kiosk ignores them)' : 'Approved segments (what the kiosk plays)';
  const errorIds = segmentErrors.map((e) => editor.segments[e.index]?.id).filter(Boolean);
  // A stored proposal's p came from the score as it was; when the score has changed
  // since approval (stale), its numbers are not shown.
  const draftBoundaries = pending?.proposal?.boundaries
    ?? (storedProposalCurrent(learn) ? learn.draft.proposal.boundaries : null) ?? null;

  return (
    <Stack gap="sm" p="md" className="sm-score">
      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Anchor component={Link} to={LIBRARY_ROUTE} size="sm">
            <Group gap={4}><IconChevronLeft size={14} />Sheet music</Group>
          </Anchor>
          <Title order={3}>{id.split('/').pop() || 'Score'}</Title>
          <Text size="xs" c="dimmed" ff="monospace">{id}</Text>
        </Stack>
        {ready ? (
          <Group gap="xs">
            {hasApproved ? <Badge color="green" variant="light">approved</Badge> : <Badge color="gray" variant="light">not approved</Badge>}
            {hasDraft ? <Badge color="yellow" variant="light">draft saved</Badge> : null}
            {dirty ? <Badge color="orange" variant="light">unsaved changes</Badge> : null}
          </Group>
        ) : null}
      </Group>

      {loadFailed ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="Could not open this score">
          <Stack gap="xs">
            <Text size="sm">{loadFailed}</Text>
            <Group><Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={() => setReloadKey((k) => k + 1)}>Try again</Button></Group>
          </Stack>
        </Alert>
      ) : null}

      {learn?.stale ? (
        <Alert color="orange" variant="filled" icon={<IconAlertTriangle size={16} />} title="Approved segments are stale" data-testid="stale-banner">
          The score file changed after these segments were approved, so the kiosk ignores them and cuts the score itself.
          Check the bars below and approve again.
        </Alert>
      ) : null}

      {pieceOverride ? (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />} data-testid="piece-override">
          Household config overrides approved segments for this piece (sheetmusic.learn.pieces). The kiosk plays those
          segments whatever is approved here, until that entry is removed.
        </Alert>
      ) : null}

      {notice ? (
        <Alert color={notice.color} variant="light" withCloseButton onClose={() => setNotice(null)}>{notice.text}</Alert>
      ) : null}

      {ready ? (
        <Group gap="xs" wrap="wrap">
          {editing ? (
            <>
              <Button size="sm" leftSection={<IconDeviceFloppy size={16} />} onClick={onSave} disabled={!canWrite} loading={busy === 'save' && !dialog}>
                Save draft
              </Button>
              <Button size="sm" color="green" leftSection={<IconCheck size={16} />} onClick={onApprove} disabled={!canWrite}>
                Approve
              </Button>
              <Button size="sm" variant="default" leftSection={<IconX size={16} />} onClick={discard} disabled={Boolean(busy) || (hasDraft && !dirty)}>
                {hasDraft ? 'Discard changes' : 'Cancel'}
              </Button>
            </>
          ) : (
            <Button size="sm" leftSection={<IconPencil size={16} />} onClick={startEdit} disabled={!hasGenerated && !hasApproved}>
              Edit
            </Button>
          )}
          <Button size="sm" variant="light" leftSection={<IconSparkles size={16} />} onClick={onPropose} disabled={Boolean(busy) || !measureCount}>
            Propose segments
          </Button>
          <Button
            size="sm"
            variant="light"
            color="gray"
            leftSection={<IconPhoto size={16} />}
            onClick={onGeneratePoster}
            disabled={Boolean(busy) || posterKind === 'scan'}
            loading={busy === 'poster'}
            title={posterKind === 'scan' ? 'This score has a scanned poster, which the kiosk shows instead.' : undefined}
            data-testid="generate-poster"
          >
            {posterKind === 'generated' ? 'Regenerate poster' : 'Generate poster'}
          </Button>
          {hasApproved ? (
            <Button size="sm" variant="light" color="orange" leftSection={<IconArrowBackUp size={16} />} onClick={() => setDialog('revert')} disabled={Boolean(busy) || !hasGenerated}>
              Revert to generated
            </Button>
          ) : null}
        </Group>
      ) : null}

      {editing && formErrors.length ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} data-testid="form-errors">
          {formErrors.map((e) => <Text key={e.code} size="sm">{describeError(e)}</Text>)}
        </Alert>
      ) : null}
      {editing && segmentErrors.length ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} data-testid="segment-errors">
          <List size="sm" spacing={0}>
            {segmentErrors.map((e, i) => <List.Item key={`${e.code}-${e.id}-${i}`}>{describeError(e)}</List.Item>)}
          </List>
        </Alert>
      ) : null}
      {serverErrors ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="The server refused these segments" data-testid="server-errors">
          {serverErrors.length
            ? <List size="sm" spacing={0}>{serverErrors.map((e, i) => <List.Item key={`${e.code}-${i}`}>{describeError(e)}</List.Item>)}</List>
            : <Text size="sm">No details came back.</Text>}
        </Alert>
      ) : null}
      {editing && uncovered.length && !allErrors.length ? (
        <Alert color="yellow" variant="light" data-testid="uncovered-warning">
          {`Not in any segment: ${uncovered.map((i) => barsLabel(measures, i, i)).join(', ')}. The kiosk will not teach these bars.`}
        </Alert>
      ) : null}

      {ready ? (
        <Stack gap="xs">
          {editing ? (
            <>
              <MeasureStrip
                measures={measures}
                segments={editor.segments}
                editable
                dispatch={dispatch}
                variant="draft"
                title="Draft"
                errorIds={errorIds}
                selectedId={selectedId}
                onSelect={setSelectedId}
                boundaries={draftBoundaries}
              />
              {hasApproved ? <MeasureStrip measures={measures} segments={approved} variant="approved" title="Approved" /> : null}
            </>
          ) : (
            <MeasureStrip
              measures={measures}
              segments={viewSegments}
              variant={hasApproved ? 'approved' : 'generated'}
              title={viewTitle}
            />
          )}
        </Stack>
      ) : null}

      {!loadFailed && !engraved ? <Skeleton height={320} radius="sm" data-testid="score-loading" /> : null}
      <div className="sm-score__sheet" style={engraved ? undefined : { visibility: 'hidden', height: 0, overflow: 'hidden' }}>
        <div className="sm-score__page">
          <div className="sm-score__host" ref={hostRef} data-testid="score-host" />
          {engraved ? (
            <div className="sm-score__overlay" aria-hidden="true" data-testid="score-overlay">
              <SegmentOverlay segments={editing ? approved : viewSegments} measures={measures} bounds={engraved.bounds} variant="approved" />
              {editing ? <SegmentOverlay segments={editor.segments} measures={measures} bounds={engraved.bounds} variant="draft" /> : null}
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        opened={confirmPropose != null}
        onClose={() => setConfirmPropose(null)}
        title="Replace your current segments with a proposal?"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            {dirty ? 'Your unsaved changes will be lost.' : 'The saved draft stays on disk until you save the proposal.'}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setConfirmPropose(null)}>Keep my segments</Button>
            <Button onClick={() => applyProposal(confirmPropose, true)}>Replace</Button>
          </Group>
        </Stack>
      </Modal>

      <ApproveDialog
        opened={dialog != null}
        mode={dialog || 'approve'}
        scoreId={id}
        measures={measures}
        measureCount={measureCount}
        generated={generated || []}
        onClose={() => setDialog(null)}
        onDone={onDialogDone}
        onDraftChanged={onDraftChanged}
        logger={logger}
      />
    </Stack>
  );
}
