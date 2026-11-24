import { useContext, useMemo, useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPI, DaylightAPIText } from '../../../../../../../frontend/src/lib/api.mjs';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import ScoreGrid from './ScoreGrid.jsx';
import ScoreViewer from './ScoreViewer.jsx';
import ScorePlayer from './ScorePlayer.jsx';
import { resolveScoreGroups } from './scoreGroups.js';
import { isNotationId, collectionListPath, useScoreImage, scoreViewPath } from './sheetMusicModel.js';
import { useKeyboardOnly } from './office/KeyboardOnlyContext.js';
import PianoUserContext from '../../PianoUserContext.jsx';
import { resolveLearnerAssist } from './learnerAssist.js';

/**
 * Sheet Music mode — browse a folder of scores and view them.
 *
 * Scores live as files under the media tree (e.g. media/docs/sheet-music/) and
 * are listed by the generic content API. MusicXML files (.musicxml/.mxl) are
 * engraved interactively by ScorePlayer; scanned page-image scores (e.g. a Plex
 * collection) fall back to ScoreViewer's image pages.
 *
 * Routed so the score id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index      → score grid
 *   view/*     → score viewer (splat holds the full content id, which may
 *                contain slashes, e.g. files:docs/sheet-music/fur-elise.musicxml)
 *
 * All navigation is RELATIVE (navigate('view/…') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * The score source comes from piano config `sheetmusic.collection`.
 */

export function SheetMusic() {
  const { config } = usePianoKioskConfig();
  // Grouped tabs (sheetmusic.collections) or the legacy single collection —
  // either way ScoreGrid receives ordered {label, listPath} groups.
  const groups = useMemo(
    () => resolveScoreGroups(config.sheetmusic)
      .map((g) => ({ label: g.label, ref: g.ref, listPath: collectionListPath(g.ref) }))
      .filter((g) => g.listPath),
    [config.sheetmusic],
  );
  // A learner with a track (`sheetmusic.learners.<id>.collection`) lands on its tab.
  // Read without the hook's throw: a screen with no roster simply has no track.
  const currentUser = useContext(PianoUserContext)?.currentUser ?? null;
  const trackRef = resolveLearnerAssist(config.sheetmusic?.learners, currentUser ?? null).collection;
  return (
    <Routes>
      <Route index element={<ScoreGridRoute groups={groups} trackRef={trackRef} />} />
      <Route path="view/*" element={<ScoreViewerRoute />} />
    </Routes>
  );
}

/** Score grid → push the selected score's content id (relative). */
function ScoreGridRoute({ groups, trackRef = null }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const navigate = useNavigate();
  return (
    <ScoreGrid
      groups={groups}
      trackRef={trackRef}
      onSelect={(item) => {
        logger.info('piano.score-select', { id: item.id });
        // The id can contain slashes (a file path); they become real path
        // segments under view/* and round-trip via the splat param. Other
        // reserved characters (# ? %) are encoded so they stay in the path.
        navigate(scoreViewPath(item.id));
      }}
    />
  );
}

/**
 * Score viewer route. The splat holds the full content id. A MusicXML id
 * (.musicxml/.mxl) opens the interactive engraved ScorePlayer; anything else (e.g. a
 * Plex page-image score) opens the page-image ScoreViewer.
 */
function ScoreViewerRoute() {
  const params = useParams();
  const contentId = params['*'] || '';
  const imageScore = useMemo(() => ({ id: contentId }), [contentId]);
  if (isNotationId(contentId)) return <NotationScore contentId={contentId} />;
  return <ScoreViewer score={imageScore} />;
}

/**
 * Fetches a MusicXML file's raw contents from the media stream endpoint, then
 * hands it to ScorePlayer to engrave. ScorePlayer derives title/composer/tempo
 * from the embedded XML, so no extra metadata is needed here.
 *
 * A same-basename image sidecar (a curated scan, resolved via `useScoreImage`) is
 * passed through as a splash — shown right-sized while the raw XML fetches and while
 * ScorePlayer engraves, so the user sees the score's artwork instead of a blank stage.
 *
 * The score's approved Learn segments (`GET piano/sheet-music/learn`) are fetched
 * alongside the XML, and the player does not open until both have settled. Child
 * progress is keyed by bar range: opening with generated segments while approved
 * ones exist (because this fetch failed) would let a saved take rewrite the
 * child's stored summary to the generated ranges. So a Learn failure gets one
 * immediate retry and then shows the same "Try again" screen as an XML failure.
 * `{}` (no approved segments) is a success.
 */
const LEARN_RETRY_BACKOFF_MS = 750;

async function fetchLearnFile(contentId, isCancelled) {
  const path = `api/v1/piano/sheet-music/learn?id=${encodeURIComponent(contentId)}`;
  try {
    return await DaylightAPI(path);
  } catch (err) {
    // A 404 stays a failure, never {}: a missing route must not drop approved
    // segments unnoticed, and frontend and backend ship in one image.
    if (isCancelled()) throw err; // a closed score makes no second request
    if (err?.transient) await new Promise((resolve) => setTimeout(resolve, LEARN_RETRY_BACKOFF_MS));
    if (isCancelled()) throw err;
    return DaylightAPI(path); // one automatic retry; a second failure propagates
  }
}

export function NotationScore({ contentId }) {
  const keyboardOnly = useKeyboardOnly();
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const [xml, setXml] = useState(null); // null = loading, '' = failed
  // undefined = loading, null = failed, object = the route's answer ({} = none)
  const [learnFile, setLearnFile] = useState(undefined);
  const [retryKey, setRetryKey] = useState(0);
  const fetchMsRef = useRef(0); // raw-XML fetch time → ScorePlayer's score.load telemetry
  const localId = useMemo(() => contentId.replace(/^[a-z]+:/i, ''), [contentId]);
  const { image: splashImage } = useScoreImage(contentId);

  useEffect(() => {
    let cancelled = false;
    setXml(null);
    setLearnFile(undefined);
    (async () => {
      try {
        logger.info('piano.score-open', { id: localId, kind: 'notation' });
        const t0 = performance.now();
        const text = await DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localId)}`);
        fetchMsRef.current = performance.now() - t0;
        if (!cancelled) setXml(text);
      } catch (err) {
        // A cancelled open (navigated away, or Try again restarted it) is not a
        // failure of this run: stay quiet.
        if (cancelled) return;
        // Audit L2: this failure used to go only to the plain kiosk logger, so the
        // per-run session file showed the open and then nothing — no recorded
        // reason. Route it into the same file as the rest of the run by tagging
        // THIS event's context, rather than making a sessionLog child: creating
        // one auto-emits 'session-log.start' (Logger.js:217) and would open an
        // extra session file per score open. The backend sessionFile transport
        // keys on context.app + context.sessionLog per event, so the tag alone
        // is enough for it to land in the active run log.
        logger.warn('piano.score-open-failed', { id: localId, error: err.message },
          { context: { app: 'piano-sheetmusic', sessionLog: true } });
        setXml('');
      }
    })();
    (async () => {
      try {
        const file = await fetchLearnFile(contentId, () => cancelled);
        if (!cancelled) setLearnFile(file && typeof file === 'object' ? file : {});
      } catch (err) {
        if (cancelled) return; // same as above: a cancelled open logs nothing
        // Same session-log routing as piano.score-open-failed above (and for the
        // same reason: tag the event's context, never make a sessionLog child).
        logger.warn('piano.score-learn-failed',
          { id: localId, error: err?.message, status: err?.status, transient: err?.transient },
          { context: { app: 'piano-sheetmusic', sessionLog: true } });
        setLearnFile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [contentId, localId, logger, retryKey]);

  const failed = xml === '' || learnFile === null;
  // The office screen has no touch: its way back is the Pieces key, so no button is drawn.
  if (failed) return keyboardOnly ? <PianoEmpty message="Could not load this score. Play the Pieces key to go back." />
    : <PianoEmpty message="Could not load this score." actionLabel="Try again" onAction={() => setRetryKey((k) => k + 1)} />;
  if (xml === null || learnFile === undefined) return <ScoreSplash image={splashImage} />;
  return <ScorePlayer score={{ id: contentId, musicXml: xml, fetchMs: fetchMsRef.current, splashImage, learnFile }} />;
}

/**
 * Loading splash for a score: its right-sized sidecar scan (object-fit: contain, so it
 * never overflows/scrolls) if one exists, else the neutral skeleton. Used while the raw
 * XML fetches and, inside ScorePlayer, while the engraving renders.
 */
export function ScoreSplash({ image }) {
  if (!image) return <SkeletonStage />;
  return (
    <div className="piano-score-splash">
      <img className="piano-score-splash__img" src={image} alt="" decoding="async" />
    </div>
  );
}

export default SheetMusic;
