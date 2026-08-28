/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns two navigation levels: the home section grid (spec §8), and
 * — inside the banks section — the picker-flow: launching tracked work while
 * unclaimed opens the ProfilePicker with the launch pending (spec §6 — claim
 * prompt on tracked work; browsing never prompts).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ProfilePicker from '../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../lib/identity/ProfileAvatar.jsx';
import { SchoolProfileProvider, useSchoolProfile } from './identity/SchoolProfileContext.jsx';
import useArmedAction from '../../lib/identity/useArmedAction.js';
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import SchoolHome from './home/SchoolHome.jsx';
import SubjectPage from './home/SubjectPage.jsx';
import LibraryPage from './home/LibraryPage.jsx';
import PrintCenter from './print/PrintCenter.jsx';
import TypingTutor from './Typing/TypingTutor.jsx';
import GeographyGrid from './geography/GeographyGrid.jsx';
import ChessLessons from './chess/ChessLessons.jsx';
import GeoQuizRunner from './geography/GeoQuizRunner.jsx';
import Icon from './home/icons/Icon.jsx';
import { SchoolBreadcrumbProvider, useSchoolBreadcrumbBar } from './SchoolBreadcrumbContext.jsx';
import { groupBySubject, subjectLabel } from './home/subjects.js';
import SentenceLadderProgram from './Programs/SentenceLadder/SentenceLadderProgram.jsx';
import LanguageReelsProgram from './Programs/LanguageReels/LanguageReelsProgram.jsx';
import FlashcardProgram from './Programs/Flashcards/FlashcardProgram.jsx';
import FlashcardDeckBrowser from './Programs/Flashcards/FlashcardDeckBrowser.jsx';
import RubiksCubeProgram from './Programs/RubiksCube/RubiksCubeProgram.jsx';
import ReportPanel from './report/ReportPanel.jsx';
import AdaptiveTutorPanel from './remediation/AdaptiveTutorPanel.jsx';
import LearningCatalogBrowser from './catalog/LearningCatalogBrowser.jsx';
import LearningContentReader from './catalog/LearningContentReader.jsx';
import LearningProbeRunner from './probes/LearningProbeRunner.jsx';
import { languageApi } from './Programs/SentenceLadder/languageApi.js';
import { schoolApi } from './schoolApi.js';
import { schoolLog } from './schoolLog.js';
import { useSchoolLaunch } from './useSchoolLaunch.js';
import { moduleLaunchAllowed } from './catalog/certification.js';
import Keypad from './selfService/Keypad.jsx';
import AgendaStatusBoard from './status/AgendaStatusBoard.jsx';
import LaunchCard from './selfService/LaunchCard.jsx';
import LaunchCardPreview from './selfService/LaunchCardPreview.jsx';
import ScanCeremony from './selfService/ScanCeremony.jsx';
import { useSelfService, DEFAULT_IDLE_TIMEOUT_SECONDS } from './selfService/useSelfService.js';
import { useScanCeremony } from './selfService/useScanCeremony.js';
import ReadalongPlaylistPlayer from '../Player/ReadalongPlaylistPlayer.jsx';
import { ShutdownBlackout, useShutdownLock } from '../../hooks/useShutdownLock.js';
import './School.scss';

/**
 * Lock mode (self-service access codes design, D6): PER-SCREEN, never
 * household-wide. `data/household/screens/<id>.yml` carries
 * `school: { mode: locked }`, so the school-room panel shows a keypad while a
 * parent's `/school` in a browser stays fully browsable — which is exactly why
 * no master code or parent bypass has to exist.
 *
 * The SCREEN YAML is the live path and the one Task 9 flips. An explicit `mode`
 * prop still wins when given, but note where it can come from: the live
 * renderer is `PanelRenderer.jsx` (`<Component {...(node.props || {})} />`), so
 * a layout child must nest it under `props:` — `{ widget: school, props: {
 * mode: locked } }`. It does NOT spread the node's own keys. (`WidgetWrapper.jsx`
 * does spread the whole config, but nothing imports it; do not design against
 * it.) A standalone app mount ('browser') never asks at all.
 *
 * Fails OPEN — an unreachable/absent screen config leaves the panel browsable.
 * "Config absent" and "fetch failed" are indistinguishable from here, and
 * "both switches off is today, exactly" is the rollout contract; locking on a
 * failed read would lock panels nobody configured.
 *
 * `resolved` gates the first render so a locked panel never flashes the
 * browsable home before the config lands.
 */
/**
 * THE STANDALONE MOUNT IS LOCKED TOO (2026-08-20).
 *
 * It was not, and the reasoning was that a parent's `/school` in a browser is
 * the bypass, so no master code has to exist. That is a coherent design and it
 * is not the one asked for: a locked school room where one URL walks straight
 * past the keypad is not locked. `/app/school` and `/school` now open on the
 * keypad like the panel does.
 *
 * THE ESCAPE IS EXPLICIT AND WRITTEN DOWN rather than removed: `?school=open`
 * on either URL restores the browsable app for whoever needs to look something
 * up. It is a query param and not a code because it is not a secret — it is a
 * different door, and a child who finds it has found the browsable catalogue,
 * which is the state this shipped in for months.
 */
function browserModeFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('school');
    return v === 'open' || v === 'unlocked' ? 'open' : v === 'locked' ? 'locked' : null;
  } catch { return null; }
}

// Number(null) and Number('') are both zero. Props default to null and absent
// YAML keys may arrive as null, so a bare Number.isFinite(Number(value)) makes
// "not configured" override the real screen config with a disabled timeout.
const configuredSeconds = (value) => (
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null
);

function useSchoolLockMode({ screenId, mode, idleTimeoutSeconds, screenOffTimeoutSeconds }) {
  const explicit = mode === 'locked' || mode === 'open' || mode === 'unlocked';
  // A standalone mount resolves synchronously — there is no screen config to
  // fetch — and it defaults to LOCKED so the keypad is what opens.
  const browserLocked = () => (browserModeFromUrl() ?? 'locked') === 'locked';
  const [state, setState] = useState(() => (
    explicit
      ? { resolved: true, locked: mode === 'locked', idleTimeoutSeconds: null, screenOffTimeoutSeconds: null }
      : screenId === 'browser'
        ? { resolved: true, locked: browserLocked(), idleTimeoutSeconds: null, screenOffTimeoutSeconds: null }
        : { resolved: false, locked: false, idleTimeoutSeconds: null, screenOffTimeoutSeconds: null }
  ));

  useEffect(() => {
    if (explicit) {
      setState({ resolved: true, locked: mode === 'locked', idleTimeoutSeconds: null, screenOffTimeoutSeconds: null });
      return undefined;
    }
    if (screenId === 'browser') {
      setState({ resolved: true, locked: browserLocked(), idleTimeoutSeconds: null, screenOffTimeoutSeconds: null });
      return undefined;
    }
    let alive = true;
    schoolApi.screenSchoolConfig(screenId).then(({ ok, data }) => {
      if (!alive) return;
      const cfg = (ok && data && typeof data.school === 'object') ? data.school : null;
      setState({
        resolved: true,
        locked: cfg?.mode === 'locked',
        idleTimeoutSeconds: configuredSeconds(cfg?.idleTimeoutSeconds),
        screenOffTimeoutSeconds: configuredSeconds(cfg?.screenOffTimeoutSeconds),
      });
    });
    return () => { alive = false; };
  }, [explicit, mode, screenId]);

  return {
    resolved: state.resolved,
    locked: state.locked,
    // Prop (widget config) → screen config → the design's default.
    idleTimeoutSeconds: configuredSeconds(idleTimeoutSeconds) !== null
      ? configuredSeconds(idleTimeoutSeconds)
      : (state.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS),
    // Automatic display sleep is opt-in. The manual, two-tap control remains
    // available on the keypad even when this is zero.
    screenOffTimeoutSeconds: configuredSeconds(screenOffTimeoutSeconds) !== null
      ? configuredSeconds(screenOffTimeoutSeconds)
      : (state.screenOffTimeoutSeconds ?? 0),
  };
}

/**
 * Deep-link URL model. Active for the standalone app mount (/school,
 * /app/school) AND the Portal screen mount (/screen(s)/<id>) — the base is
 * whatever prefix schoolUrlBase() resolves. The URL matches the breadcrumb all
 * the way down; the materials chain past a subject/library section is the raw
 * id trail, so a leaf deep-links straight to a playing track:
 *   <base>                                        -> home
 *   <base>/subject/<id>                           -> subject shelf
 *   <base>/subject/<id>/<collectionId>            -> a collection's works
 *   <base>/subject/<id>/<collectionId>/<workId>   -> a work's chapters
 *   <base>/subject/<id>/<collectionId>/<workId>/<trackId>  -> playing a track
 *   <base>/subject/<id>/<showId>/<episodeId>      -> playing a video episode
 *   <base>/library[/…chain]                       -> Library (same chain rules)
 *   <base>/catalog | /progress | /practice | /print | /typing | /lang/<courseId>
 */
function schoolUrlBase() {
  const path = window.location.pathname;
  // Standalone app mount: /school or /app/school.
  const app = path.match(/^(.*?\/(?:app\/)?school)(?:\/|$)/);
  if (app) return app[1];
  // Screen-framework mount (the Portal): the base is /screen(s)/<screenId> and
  // School's deep segments follow it. This runs only inside a mounted School,
  // and School is only ever a screen's widget on the Portal — so matching any
  // /screen(s)/<id> here is safe (a non-School screen never mounts School).
  const screen = path.match(/^(\/screens?\/[^/]+)(?:\/|$)/);
  if (screen) return screen[1];
  return null;
}
import { screenIdFromUrlBase, parseSchoolPath, schoolPathFor } from './schoolPathModel.js';

function SchoolShell({ clear, mode = null, idleTimeoutSeconds = null, screenOffTimeoutSeconds = null }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, closePicker, claim, continueAsGuest } = useSchoolProfile();
  const { crumbs: extraCrumbs } = useSchoolBreadcrumbBar();
  const urlBase = useMemo(schoolUrlBase, []);
  const screenId = useMemo(() => screenIdFromUrlBase(urlBase), [urlBase]);
  const initialLink = useMemo(() => parseSchoolPath(urlBase), [urlBase]);
  const [section, setSection] = useState(initialLink.section); // a sections id, or null = home grid
  // The materials chain below the section (collection → work → track ids). It
  // is both the DEEP-LINK input MaterialsSection restores from on entry and the
  // live nav state it reports back so the URL stays in lock-step with the
  // breadcrumb all the way down to a playing track.
  const [materialPath, setMaterialPath] = useState(initialLink.materialPath);
  const [active, setActive] = useState(null);
  const [runNonce, setRunNonce] = useState(0); // Try-again remount counter   // bounded runner or shared remediation session
  // Whether the NEXT runner mount should open its session fresh (Task 17):
  // Try again on a finished quiz restarts from q1 (wipes the sitting), while
  // Start again after a server timeout resumes it. Latched by the restart
  // handler because the remount-by-key reopens the session with only props —
  // without this flag the restarted run would silently resume itself.
  const [runFresh, setRunFresh] = useState(false);
  useEffect(() => { setRunFresh(false); }, [active]); // a NEW launch is never a restart
  const [pending, setPending] = useState(null); // bank/module launch awaiting a claim
  const [notice, setNotice] = useState(null);
  const [materials, setMaterials] = useState([]); // full catalog materials list, unfiltered
  const [courses, setCourses] = useState([]);     // sentence-ladder language courses
  const [studyLaunch, setStudyLaunch] = useState(null);
  const [reelLaunch, setReelLaunch] = useState(null);
  const [cubeLaunch, setCubeLaunch] = useState(null);
  const [banks, setBanks] = useState([]);         // bank summaries, for shelving + titles
  // The catalog fetch is Plex-backed and can be SLOW on a cold cache (first open
  // after a redeploy fans out to every source). Track whether it has resolved so
  // a subject shelf can show a skeleton during the load rather than the empty
  // state, which otherwise reads as "stuck/broken" while it's legitimately loading.
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  // This mount's certified surface (spec §4.2). Resolved once on ready and
  // held for the session — a screen doesn't change identity mid-visit. A
  // failed/unresolved profile (404 fail-closed, or any other non-ok) leaves
  // this null, which is exactly the state moduleLaunchAllowed's null-map
  // fail-closed handles: catalog learning launches simply never clear.
  const [surfaceId, setSurfaceId] = useState(null);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    let alive = true;
    schoolApi.surfaceProfile(screenId).then(({ ok, data }) => {
      if (!alive) return;
      if (ok && data?.surfaceId) {
        setSurfaceId(data.surfaceId);
      } else {
        schoolLog.surface('profile-unresolved', { screenId });
        setSurfaceId(null);
      }
    });
    return () => { alive = false; };
  }, [status, screenId]);

  // Un-grey the subject wall on materials + courses — the fast catalogues — and
  // do NOT block that render on the bank catalogue (thousands of files). Banks
  // load independently and fill the Practice shelves when ready; a subject that
  // has only banks simply un-greys a beat later. Any fetch failing just leaves
  // its content absent, never a broken panel.
  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    Promise.all([schoolApi.materials(), languageApi.courses()]).then(([mat, lang]) => {
      if (!alive) return;
      if (!mat.ok || !mat.data) schoolLog.materials('catalog-failed', { ok: mat.ok });
      setMaterials(mat.ok && Array.isArray(mat.data?.materials) ? mat.data.materials : []);
      setCourses(lang.ok && Array.isArray(lang.data) ? lang.data : []);
      setCatalogLoaded(true);
    });
    schoolApi.banks().then(({ ok, data }) => {
      if (alive) setBanks(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, [status]);

  // The nine shelves + the Library, from the three catalogues.
  const grouped = useMemo(
    // Sentence Ladder is assigned work, not a browsable app catalogue. Keep
    // course metadata for launch validation/labels but omit it from shelves.
    () => groupBySubject({ materials, banks, courses: [] }),
    [materials, banks],
  );
  const bankTitles = useMemo(() => new Map(banks.map((b) => [b.id, b.title])), [banks]);
  // Set alongside the notice, in the same synchronous pass as the
  // continueAsGuest() that produces it (see onDismiss) -- so the
  // identity-change effect below, which runs on that very transition, knows
  // to leave the freshly-set notice alone this one time rather than
  // immediately wiping out the notice its own transition just created.
  const justSetNoticeRef = useRef(false);

  const start = useCallback(async (bankSummary, mode, asGuest) => {
    if (asGuest && bankSummary.audience !== 'generic') {
      justSetNoticeRef.current = true;
      setNotice('Sign in to take this one — guests get the practice sets.');
      return;
    }
    const { ok, data } = await schoolApi.bank(bankSummary.id);
    // setRunFresh(false): a new launch is never a restart — cleared here (not
    // only in the active-change effect) so correctness never rides on
    // parent/child effect ordering.
    if (ok) { setNotice(null); setRunFresh(false); setActive({ bank: data, mode }); }
    // Reports whether a runner actually mounted. The keypad path needs this:
    // it must keep its card up and say something when the mount misses,
    // rather than closing to a bare keypad. Callers that ignore it (the
    // picker flow, progress follow-ups) are unaffected.
    return ok;
  }, []);

  // Returns the in-flight promise (rather than firing-and-forgetting) so a
  // caller — BankBrowser's double-tap guard — can await completion before
  // re-arming, the same async-guard convention as FlashcardRunner's grade().
  const onLaunch = useCallback(async (bankSummary, mode) => {
    if (!currentUser && !isGuest) {
      setPending({ kind: 'bank', bankSummary, mode });
      openPicker();
      return;
    }
    await start(bankSummary, mode, isGuest);
  }, [currentUser, isGuest, openPicker, start]);

  const startFlashcardDeck = useCallback(async (deckSummary, learnerId = currentUser?.id ?? null) => {
    const { ok, data } = await schoolApi.flashcardDeck(deckSummary.id);
    if (ok && data?.deck) {
      setNotice(null);
      setActive({ mode: 'flashcard_program', descriptor: {
        deck: data.deck, bank: null, policy: {}, userId: learnerId,
      }, learning: null });
    }
    return ok;
  }, [currentUser?.id]);

  const onFlashcardDeckLaunch = useCallback(async (deckSummary) => {
    if (!currentUser && !isGuest) { setPending({ kind: 'flashcard-deck', deckSummary }); openPicker(); return false; }
    return startFlashcardDeck(deckSummary);
  }, [currentUser, isGuest, openPicker, startFlashcardDeck]);

  // Certification gate (spec §4.2): consulted ONLY here, on catalog module
  // launches — startLearning's one caller chain is onLearningLaunch/onPick/
  // onDismiss, all originating from LearningCatalogBrowser's onLaunch, so
  // gating here never touches banks/geo/typing/programs. `launch.certification`
  // is the verdict Map LearningCatalogBrowser built for the opened lesson (or
  // null if this surface's profile never resolved); moduleLaunchAllowed fails
  // closed on either a null map or an unknown moduleId. A refusal reuses the
  // learning_unsupported panel — its "capability not installed" copy already
  // fits a screen the module isn't certified for.
  const startLearning = useCallback((launch) => {
    const { module, learning, certification } = launch;
    setRunFresh(false); // a new launch is never a restart (see `start` above)
    if (!moduleLaunchAllowed(certification, module.moduleId)) {
      const reasons = certification?.get?.(module.moduleId)?.reasons ?? [];
      schoolLog.surface('launch-refused', { moduleId: module.moduleId, surfaceId, reasons });
      setActive({ mode: 'learning_unsupported', module, learning });
      return;
    }
    if (module.type === 'learning_probe') setActive({ mode: 'learning_probe', module, learning });
    else if (module.type === 'lecture_notes' || module.type === 'examples') setActive({ mode: 'learning_reader', module, learning });
    else if (module.type === 'flashcards') {
      // A catalog-resolved rich deck is rendered by the reusable program; old
      // bank-only modules keep their established runner and session contract.
      if (module.deck && module.deck.schema === 'school.flashcard-deck/v1') {
        setActive({ mode: 'flashcard_program', descriptor: { deck: module.deck, bank: module.bank ?? null, policy: module.policy ?? {}, userId: currentUser?.id ?? null, learning }, learning });
      } else setActive({ mode: 'flashcard', bank: module.bank, learning });
    }
    else if (module.type === 'quiz') setActive({ mode: 'quiz', bank: module.bank, learning });
    else if (module.type === 'problems') setActive({ mode: 'problems', bank: module.bank, learning });
    else setActive({ mode: 'learning_unsupported', module, learning });
  }, [surfaceId, currentUser?.id]);

  const onLearningLaunch = useCallback((launch) => {
    const tracked = ['problems', 'flashcards', 'quiz', 'learning_probe', 'activity'].includes(launch.module.type);
    if (tracked && !currentUser && !isGuest) {
      setPending({ kind: 'learning', launch });
      openPicker();
      return;
    }
    startLearning(launch);
  }, [currentUser, isGuest, openPicker, startLearning]);

  const onPick = useCallback((id) => {
    claim(id);
    if (pending?.kind === 'bank') start(pending.bankSummary, pending.mode, false);
    if (pending?.kind === 'learning') startLearning(pending.launch);
    if (pending?.kind === 'flashcard-deck') startFlashcardDeck(pending.deckSummary, id);
    setPending(null);
  }, [claim, pending, start, startLearning, startFlashcardDeck]);

  // Explicit "continue as guest" (the picker's guest row) — the ONLY path
  // that demotes an unclaimed learner to Guest and resolves whatever launch
  // is pending. `start`'s own asGuest/audience gate still applies here, so a
  // guest tapping through on an assigned bank gets the "sign in" refusal
  // notice rather than the runner (unchanged from the old dismiss behavior —
  // only WHICH affordance triggers it has moved).
  const onGuest = useCallback(() => {
    continueAsGuest();
    if (pending?.kind === 'bank') start(pending.bankSummary, pending.mode, true);
    if (pending?.kind === 'learning') startLearning(pending.launch);
    if (pending?.kind === 'flashcard-deck') startFlashcardDeck(pending.deckSummary, null);
    setPending(null);
  }, [continueAsGuest, pending, start, startLearning, startFlashcardDeck]);

  // ✕ / backdrop / auto-timeout — a CANCEL, not a guest demotion. Closes the
  // sheet and drops whatever launch was pending; identity (claimed, guest, or
  // unclaimed) is left exactly as it was. Guest is a choice made via the
  // guest row (onGuest above), never a side effect of walking away.
  const onDismiss = useCallback(() => {
    closePicker();
    setPending(null);
  }, [closePicker]);

  const syncUrl = useCallback((sec, chain = []) => {
    if (!urlBase) return;
    const path = schoolPathFor(urlBase, sec, chain);
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
  }, [urlBase]);

  const openSection = useCallback((id) => {
    setSection(id);
    setMaterialPath([]);
    syncUrl(id, []);
    schoolLog.nav('section', { section: id });
  }, [syncUrl]);

  // Portal-launch subscription (design §4.3): a scan resolves to on-screen
  // work and the backend hands it to whichever screen has School mounted.
  // useSchoolLaunch claims the learner; routing into the named runner is
  // this callback's job. A Sentence Ladder target must explicitly name its
  // corpus and carry learner-scoped launch authority. A bank target resolves the
  // bare `bankId` against the loaded summaries (the same `start()` the quiz
  // Start button calls) rather than the generic `onLaunch` above, because
  // the learner is already claimed here — routing back through `onLaunch`
  // would re-trigger its unclaimed-picker branch on stale identity state.
  // Either miss (no course loaded, unknown bankId) logs and stays inert
  // rather than crashing on a screen nobody is watching yet.
  //
  // RETURNS whether it mounted. The WS caller ignores it — a broadcast miss on
  // a screen nobody is watching should stay inert. The KEYPAD caller does not:
  // a child who just pressed a button and got nothing needs words, so
  // `useSelfService` keeps the card up unless this answers `true`.
  const onPortalLaunch = useCallback(async (target, launchedLearnerId = null) => {
    if (target?.kind === 'companion' && target.presentation === 'readalong') {
      setActive({ mode: 'lesson_companion', descriptor: target });
      return true;
    }
    if (target?.kind === 'program' && ['sentence-ladder', 'language'].includes(target.program)) {
      const courseId = target.corpusId ?? null;
      const learnerId = launchedLearnerId ?? target.learnerId ?? null;
      if (!courseId || !target.studyGrant || !learnerId || !courses.some((course) => course.id === courseId)) {
        schoolLog.bank('program-unavailable', { program: target.program });
        return false;
      }
      setStudyLaunch({ learnerId, corpusId: courseId, studyGrant: target.studyGrant });
      openSection(`sentence-ladder:${courseId}`);
      return true;
    }
    if (target?.kind === 'program' && target.program === 'language-reels') {
      const learnerId = launchedLearnerId ?? target.learnerId ?? null;
      if (!target.reelId || !target.reelGrant || !target.unitId || !learnerId) {
        schoolLog.bank('program-unavailable', { program: target.program });
        return false;
      }
      setReelLaunch({ learnerId, reelId: target.reelId, reelGrant: target.reelGrant });
      setStudyLaunch(null);
      openSection('language-reels');
      return true;
    }
    if (target?.kind === 'program' && target.program === 'rubiks-cube') {
      const learnerId = launchedLearnerId ?? target.learnerId ?? null;
      if (!target.courseId || !target.cubeGrant || !learnerId) return false;
      setCubeLaunch({ learnerId, courseId: target.courseId, cubeGrant: target.cubeGrant });
      openSection('rubiks-cube');
      return true;
    }
    if (target?.kind === 'program' && target.program === 'flashcards') {
      const learnerId = launchedLearnerId ?? target.learnerId ?? null;
      if (!target.deckId || !learnerId) return false;
      const { ok, data } = await schoolApi.flashcardDeck(target.deckId);
      if (!ok || !data?.deck) return false;
      const assessment = await schoolApi.flashcardAssessment(target.deckId, { userId: learnerId });
      const bank = assessment.ok ? assessment.data?.bank ?? null : null;
      setActive({ mode: 'flashcard_program', descriptor: { deck: data.deck, bank, policy: target.policy ?? {}, userId: learnerId }, learning: null });
      openSection('flashcards');
      return true;
    }
    if (target?.kind === 'bank') {
      const bankSummary = banks.find((b) => b.id === target.bankId);
      if (!bankSummary) { schoolLog.bank('not-found', { bankId: target.bankId }); return false; }
      return (await start(bankSummary, 'quiz', false)) === true;
    }
    schoolLog.bank('launch-unroutable', { kind: target?.kind ?? null });
    return false;
  }, [courses, banks, openSection, start]);

  // Lock mode is a NARROWING of a surface that is already terminal (the Portal
  // mounts School with no `clear`), not a new cage.
  const lock = useSchoolLockMode({ screenId, mode, idleTimeoutSeconds, screenOffTimeoutSeconds });

  // The `school.launch` subscription stays live in lock mode, deliberately.
  // `portal.yml` is the ONLY screen in the house that mounts School, so
  // `PortalSurface.dispatch`'s broadcast has exactly one recipient — this
  // panel. A locked panel that ignored it would break today's QR "answer on
  // the screen" path outright: the printed slip promises "Starting on the
  // school screen" and there is no other screen to catch it.
  useSchoolLaunch({ claim, onLaunch: onPortalLaunch });

  // The keypad routes on-screen work through `onPortalLaunch` — the SAME
  // callback the broadcast lands on, and therefore the same `start()` →
  // `schoolApi.openSession` → SchoolService path. That is what registers the
  // sitting `PortalSurface.occupancy()` reads; a runner mounted any other way
  // would be invisible to DoNow's clobber protection.
  const selfService = useSelfService({
    idleTimeoutSeconds: lock.idleTimeoutSeconds,
    claim,
    onLaunch: onPortalLaunch,
  });

  const [lockSide, setLockSide] = useState('keypad-left');
  // What the Keypad reports about the child in front of it. Refs, not state:
  // the flip reads them on a tick and must never re-render the panel just
  // because a finger landed on a key.
  const keypadEngagedRef = useRef(false);
  const keypadTouchedAtRef = useRef(0);
  const onKeypadActivity = useCallback(() => { keypadTouchedAtRef.current = Date.now(); }, []);
  const onKeypadEngagedChange = useCallback((engaged) => { keypadEngagedRef.current = engaged; }, []);

  /**
   * The burn-in flip. The two static panes trade sides only while the
   * anonymous keypad is up, so a bright fixed image never sits on the same
   * half of the Portal all day.
   *
   * IT MAY NEVER PREEMPT AN INTERACTION IN PROGRESS. `direction: rtl` throws
   * the whole pad to the other half of a 1280x800 screen; the typed digits
   * survive that, but the KEYS do not stay under a finger already in motion,
   * and a child mid-code taps where a key no longer is. Burn-in is a
   * maintenance concern and it yields to the person using the panel.
   *
   * "In progress" is BOTH facts, because either alone is wrong: a code half
   * typed while the child reads the next digit off a slip has no recent touch,
   * and a finger that has just left the pad on an empty entry is still a hand
   * over the keys. `LOCK_FLIP_QUIET_MS` covers the second; the Keypad's
   * `engaged` covers the first, plus the ~2s of a refusal animation.
   *
   * A DEFERRED FLIP IS NOT RESCHEDULED — `dueAt` is left in the past, so the
   * flip lands on the first quiet tick rather than waiting out another full
   * interval. A code finished at second 89 delays the flip by seconds, not by
   * another 90.
   *
   * AND IT CANNOT BE STARVED. There is no override that flips anyway (that
   * would just reintroduce the rug pull); instead the busy predicate is
   * short-lived by construction. A code auto-submits on its sixth digit, a
   * refusal is bounded at ~2s, an abandoned entry clears itself
   * (`ABANDONED_ENTRY_MS`), and quiet is 8s — so someone tapping every minute
   * leaves ~50s of quiet in each one, and the worst case for a panel walked
   * away from mid-code is a deferral of about 70s past due.
   */
  const LOCK_FLIP_INTERVAL_MS = 90_000;
  const LOCK_FLIP_QUIET_MS = 8_000;
  const LOCK_FLIP_TICK_MS = 1_000;
  useEffect(() => {
    if (!lock.locked || selfService.view !== 'keypad' || active || section) return undefined;
    let dueAt = Date.now() + LOCK_FLIP_INTERVAL_MS;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now < dueAt) return;
      if (keypadEngagedRef.current) return;
      if (now - keypadTouchedAtRef.current < LOCK_FLIP_QUIET_MS) return;
      setLockSide((s) => (s === 'keypad-left' ? 'keypad-right' : 'keypad-left'));
      dueAt = now + LOCK_FLIP_INTERVAL_MS;
    }, LOCK_FLIP_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, lock.locked, section, selfService.view]);

  // The scan ceremony (Slice D, omr-grading-integrity design): a scan must
  // always be acknowledged on screen. Subscribed here — not inside the lock
  // branch below — because a scan can land while the panel is either locked
  // or open (KC: "a scan must always be acknowledged on screen").
  const ceremony = useScanCeremony();

  // Local date: toISOString flips to tomorrow at 5pm PDT.
  const statusDay = (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; })();

  // Going home also clears any guest-refusal notice: the notice belongs to
  // the section visit that produced it and must not greet the next visit.
  const goHome = useCallback(() => {
    setSection(null);
    setStudyLaunch(null);
    setActive(null);
    setNotice(null);
    setMaterialPath([]);
    syncUrl(null, []);
    schoolLog.nav('home', {});
  }, [syncUrl]);

  // MaterialsSection reports its live nav chain (collection → work → track ids)
  // here so the URL tracks the breadcrumb all the way down to a playing track.
  const onMaterialNav = useCallback((chain) => {
    const next = Array.isArray(chain) ? chain.filter(Boolean) : [];
    setMaterialPath(next);
    // syncUrl reads `section` from closure; it's stable while a MaterialsSection
    // is mounted (you can't change section without unmounting it).
    setSection((sec) => { syncUrl(sec, next); return sec; });
  }, [syncUrl]);

  const onProgressFollowUp = useCallback(async (action) => {
    if (action?.target?.type === 'bank') {
      const bank = banks.find((entry) => entry.id === action.target.id);
      if (!bank) {
        setNotice('That review is not available in the current Catalog.');
        return;
      }
      await start(bank, 'quiz', false);
      return;
    }
    if (action?.target?.type === 'section') {
      openSection(action.target.id);
      return;
    }
    if (action?.target?.type === 'remediation_session' && currentUser) {
      setNotice(null);
      setActive({ mode: 'remediation', sessionId: action.target.id });
      return;
    }
    setNotice('That follow-up action is not available on this screen yet.');
  }, [banks, currentUser, start, openSection]);

  // The lesson fallback remains useful when a module did not author adaptive
  // remediation. Tutor-capable failures enter the exact server-resolved
  // lesson/concept session through onOpenTutor below.
  const onReviewLesson = useCallback(() => {
    setActive(null);
    openSection('catalog');
  }, [openSection]);
  const onOpenTutor = useCallback((sessionId) => {
    setNotice(null);
    setActive({ mode: 'remediation', sessionId });
  }, []);

  // Browser back/forward re-parse the URL — the address bar and the shell
  // never disagree, at any depth.
  useEffect(() => {
    if (!urlBase) return undefined;
    const onPop = () => {
      const link = parseSchoolPath(urlBase);
      setSection(link.section);
      setMaterialPath(link.materialPath);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [urlBase]);

  // A guest-refusal notice is only ever relevant to the identity that
  // triggered it. If the child then signs in (or otherwise changes identity,
  // e.g. via the header chip alone, with no pending launch involved) a stale
  // "sign in to take this one" notice must not linger and misrepresent the
  // current identity. The one exception is the transition that just CREATED
  // the notice (continueAsGuest() + the refusal inside start(), batched into
  // the same render) -- justSetNoticeRef lets that single pass through.
  useEffect(() => {
    if (justSetNoticeRef.current) { justSetNoticeRef.current = false; return; }
    setNotice(null);
    // A remediation session is learner-scoped at the API boundary. Changing
    // profiles pauses the panel instead of trying to reopen it as someone else.
    setActive((current) => (current?.mode === 'remediation' ? null : current));
    setStudyLaunch((current) => (
      current && current.learnerId !== currentUser?.id ? null : current
    ));
    setReelLaunch((current) => (current && current.learnerId !== currentUser?.id ? null : current));
    setCubeLaunch((current) => (current && current.learnerId !== currentUser?.id ? null : current));
  }, [currentUser?.id, isGuest]);

  const subjectId = section?.startsWith('subject:') ? section.slice(8) : null;
  const courseId = section?.startsWith('sentence-ladder:') ? section.slice(16) : null;
  const previewCourseId = section?.startsWith('sentence-ladder-preview:') ? section.slice(24) : null;
  const languageCourseId = courseId ?? previewCourseId;
  // The opaque payload from a `/launch-preview/<payload>` link. Never decoded
  // here — the backend owns the codec, and a client that also decoded it would
  // be a second opinion about what a link means.
  const launchPreviewLink = section?.startsWith('launch-preview:') ? section.slice(15) : null;
  const sectionLabel = !section ? null
      : subjectId ? subjectLabel(subjectId)
      : section === 'library' ? 'Library'
        : section === 'catalog' ? 'Catalog'
        : section === 'progress' ? 'My Progress'
          : section === 'banks' ? 'Practice'
            : section === 'print' ? 'Print'
              : section === 'typing' ? 'Typing'
                : section === 'geography' ? 'Geography'
                  : section === 'rubiks-cube' ? 'Rubik’s Cube'
                  : launchPreviewLink ? 'Launch card preview'
                  : languageCourseId ? (courses.find((c) => c.id === languageCourseId)?.label ?? 'Language')
                    : section;

  // The apple is the one fixed control in the header, so it carries the one
  // thing the Portal otherwise has no affordance for. From any depth it goes
  // home; AT home it reloads the page — the panel is a kiosk with no address
  // bar and no browser chrome, so this is the only way to pick up a deploy or
  // shake off a wedged view from inside the app. Mounted as an app (with
  // `clear`) it still exits instead: there is something behind it to exit to.
  // Mid-run leave confirm (advocacy M7): a graded run in flight holds a
  // child's un-resumable answers — one stray tap on the apple must not
  // discard them silently. Two-tap arm/confirm, the kiosk house pattern.
  const gradedRunInFlight = ['quiz', 'problems', 'probe'].includes(active?.mode);
  const { armed: leaveArmed, trigger: confirmLeave } = useArmedAction(goHome, { armMs: 4000 });
  const onApple = useCallback(() => {
    if (gradedRunInFlight) { confirmLeave(); return; }
    if (section || active) { goHome(); return; }
    if (clear) { clear(); return; }
    schoolLog.nav('reload', {});
    window.location.reload();
  }, [gradedRunInFlight, confirmLeave, section, active, clear, goHome]);

  // The header trail past the apple home anchor. Deep material routes publish
  // their own full sub-trail (section crumb → material → unit, each with its
  // own handler) via the breadcrumb bus; when none is published, the trail is
  // just the current section as a non-navigable current crumb.
  const breadcrumbTrail = extraCrumbs && extraCrumbs.length
    ? extraCrumbs
    : (section ? [{ label: sectionLabel }] : []);

  // `!lock.resolved` is part of this gate on purpose: a locked panel must never
  // flash the browsable home for the beat it takes the screen config to land.
  if (status !== 'ready' || !lock.resolved) return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className={`school-app${lock.locked ? ' school-app--locked' : ''}`}>
      {!lock.locked && (
      <header className="school-app__header">
        {/* Breadcrumb model (Piano-style): a fixed home anchor on the left,
            then the trail. The apple always returns to the subject wall from
            any depth; intermediate crumbs (section, material, unit) are the
            in-between navigation and are published by the deep routes
            themselves rather than each inventing its own back header. */}
        <nav className="school-app__crumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className="school-app__home"
            onClick={onApple}
            aria-label={section || active ? 'Home' : (clear ? 'School' : 'Refresh')}
          >
            <Icon name="apple" />
          </button>
          {breadcrumbTrail.map((c, i) => {
            const isLast = i === breadcrumbTrail.length - 1;
            return (
              <Fragment key={`${c.label}-${i}`}>
                <span className="school-app__crumb-sep" aria-hidden>›</span>
                {!isLast && c.onClick ? (
                  <button type="button" className="school-app__crumb" onClick={c.onClick}>{c.label}</button>
                ) : (
                  <span className={`school-app__crumb${isLast ? ' school-app__crumb--current' : ''}`}>{c.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
        {/* No sign-in chip for the unclaimed: the student panel's face row is
            the claim affordance, so an extra header CTA was noise. The chip
            only appears once there IS an identity to show (or a guest to
            un-guest). */}
        {(currentUser || isGuest) && (
          <button type="button" className="school-app__chip" onClick={openPicker}>
            {currentUser
              ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
              : <span>Guest</span>}
          </button>
        )}
        {leaveArmed && (
          <div className="school-app__leave-confirm" data-testid="leave-confirm" role="alert">
            Leave the quiz? Your answers so far won&rsquo;t be saved — tap the apple again to leave.
          </div>
        )}
      </header>
      )}
      <main className="school-app__body">
        {/* Scan ceremony (Slice D): a sibling of the lock branch below, NOT
            inside it — a scan can land whether the panel is locked or open,
            and this must render either way. */}
        {ceremony.current && <ScanCeremony {...ceremony.current} onDismiss={ceremony.clear} />}
        {/* Launch-card preview (teacher-only deep link). A sibling of the lock
            branch below, not inside it: the Portal is the screen most worth
            checking a card on and it is always locked, while a parent's browser
            never is — the same link has to open on both. It renders instead of
            the keypad because `section` is set, and it can mint nothing, so a
            locked panel is not weakened by being able to draw it. */}
        {launchPreviewLink && !active && (
          <LaunchCardPreview link={launchPreviewLink} onExit={goHome} />
        )}
        {/* LOCKED PANEL (design §3). The keypad IS the resting state; a
            resolved code puts the launch card over it. Runners are rendered
            below, OUTSIDE this branch, so on-screen work mounted from a code —
            or from a `school.launch` broadcast — looks the same either way. */}
        {/* C4: `section` matters here as much as `active`. A `program` action
            routes through `openSection('lang:<id>')`, which sets SECTION —
            and SentenceLadderProgram renders outside the `!lock.locked` wrapper
            below. Gating on `!active` alone mounted the program with the
            keypad still underneath it. */}
        {lock.locked && !active && !section && (
          selfService.view === 'keypad' ? (
            <div className="school-lock-split" data-side={lockSide}>
              <Keypad
                onSubmit={selfService.submit}
                busy={selfService.busy}
                message={selfService.message}
                degraded={selfService.degraded}
                onRetry={selfService.retry}
                onReload={selfService.reload}
                screenOffTimeoutSeconds={lock.screenOffTimeoutSeconds}
                screenOffSuppressed={!!ceremony.current}
                onActivity={onKeypadActivity}
                onEngagedChange={onKeypadEngagedChange}
              />
              {/* Read-only status pane: names appear here by design — this is
                  the family's own day board, not a claim affordance; codes
                  remain the only entry path. Never intercepts a tap. */}
              <div className="school-lock-split__board" aria-label="Today's school status">
                <AgendaStatusBoard kids={roster} day={statusDay} />
              </div>
            </div>
          ) : (
            <LaunchCard
              card={selfService.card}
              view={selfService.view}
              sentence={selfService.sentence}
              busy={selfService.busy}
              confirmRemainingMs={selfService.confirmRemainingMs}
              confirmTotalMs={selfService.confirmTotalMs}
              onAction={selfService.runAction}
              onConfirm={selfService.confirmPrint}
              onExit={selfService.exit}
            />
          )
        )}
        {!lock.locked && (<>
        {/* One home for claimed and unclaimed alike: the subject shelves are
            the same wall either way, and the student panel itself carries the
            claim affordance when nobody has tapped in. An explicit guest still
            browses — the pre-existing rule that browsing never prompts. */}
        {!section && (
          <SchoolHome grouped={grouped} onOpen={openSection} bankTitles={bankTitles} />
        )}
        {/* Only an EXPLICIT guest (continueAsGuest()) is restricted to the
            generic catalogue. An unclaimed child has not declined identity --
            they simply have not picked yet -- so they see everything and get
            prompted only when they try to launch tracked work (onLaunch
            above). Bank reads are ungated by design; real enforcement is
            server-side at session open (403 for guest vs an assigned bank). */}
        {/* Opens on the signed-in learner when there is one, otherwise the
            whole household. Both scopes are the same endpoint, filtered. */}
        {section === 'progress' && !active && (
          <ReportPanel
            userId={currentUser?.id || null}
            onFollowUp={currentUser ? onProgressFollowUp : null}
            /* A claimed KID gets a kid-scoped board: no Everyone unfocus, no
               admin links, no Needs-attention flag (advocacy: the kiosk board
               a child reads is theirs, not a supervision surface). Missing
               birthyear fails toward kid — same rule as the claim faces. */
            kidMode={!!currentUser && (() => {
              const u = roster.find((r) => r.id === currentUser.id);
              return !u?.birthyear || new Date().getFullYear() - u.birthyear < 18;
            })()}
          />
        )}
        {section === 'catalog' && !active && <LearningCatalogBrowser onLaunch={onLearningLaunch} surfaceId={surfaceId} />}
        {section === 'print' && <PrintCenter />}
        {section === 'typing' && <TypingTutor />}
        {section === 'geography' && !active && <GeographyGrid onLaunch={onLaunch} />}
        {section === 'chess' && !active && <ChessLessons />}
        {section === 'rubiks-cube' && !active && (
          <RubiksCubeProgram
            userId={cubeLaunch?.learnerId === currentUser?.id ? cubeLaunch.learnerId : null}
            courseId={cubeLaunch?.courseId ?? 'beginner-v1'}
            cubeGrant={cubeLaunch?.cubeGrant ?? null}
            onExit={goHome}
          />
        )}
        {section === 'banks' && !active && <><FlashcardDeckBrowser onLaunch={onFlashcardDeckLaunch} /><BankBrowser guestOnly={isGuest} onLaunch={onLaunch} notice={notice} /></>}
        {subjectId && !active && (
          <SubjectPage
            subjectId={subjectId}
            shelf={grouped.bySubject[subjectId]}
            guestOnly={isGuest}
            onLaunch={onLaunch}
            notice={notice}
            onOpen={openSection}
            initialMaterialPath={materialPath}
            onMaterialNav={onMaterialNav}
            catalogLoading={!catalogLoaded}
          />
        )}
        {section === 'library' && !active && (
          <LibraryPage
            library={grouped.library}
            guestOnly={isGuest}
            onLaunch={onLaunch}
            notice={notice}
            initialMaterialPath={materialPath}
            onMaterialNav={onMaterialNav}
          />
        )}
        </>)}
        {/* Runners sit outside the lock branch: the locked panel mounts the
            SAME QuizRunner/FlashcardRunner the SPA does, via the same
            `start()`, which is what opens the SchoolService sitting that
            `PortalSurface.occupancy()` reads. Exiting one lands back on the
            keypad. */}
        {active?.mode === 'quiz' && (
          <QuizRunner
            key={`quiz:${active.bank.id}:${runNonce}`}
            bank={active.bank}
            learning={active.learning}
            purpose={active.purpose ?? null}
            deckId={active.deckId ?? null}
            testPlan={active.testPlan ?? null}
            fresh={runFresh}
            onExit={() => setActive(null)}
            onRestart={({ fresh = true } = {}) => { setRunFresh(fresh); setRunNonce((n) => n + 1); }}
            onReview={onReviewLesson}
            onTutor={onOpenTutor}
          />
        )}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} learning={active.learning} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard_program' && (
          <FlashcardProgram
            descriptor={active.descriptor}
            onEvent={async (event) => {
              schoolLog.session('flashcard-program-event', { ...event, learning: active.learning });
              if (event.type === 'start_test' && active.descriptor.bank && active.learning) {
                const plan = event.testPlan ?? null;
                const eligible = plan
                  ? active.descriptor.bank.items.filter((item) => plan.types.includes(item.type)).slice(0, plan.count)
                  : active.descriptor.bank.items;
                setRunFresh(false);
                setActive({ mode: 'quiz', bank: { ...active.descriptor.bank, items: eligible }, learning: active.learning, purpose: 'flashcard_test', testPlan: plan });
              } else if (event.type === 'start_test' && active.descriptor.userId) {
                const plan = event.testPlan ?? null;
                const { ok, data } = await schoolApi.flashcardAssessment(active.descriptor.deck.id, { userId: active.descriptor.userId, testPlan: plan });
                if (!ok || !data?.bank) return { ok: false };
                setRunFresh(false);
                setActive({ mode: 'quiz', bank: data.bank, learning: null, purpose: 'flashcard_assessment', deckId: active.descriptor.deck.id, testPlan: plan });
              }
              return { ok: true };
            }}
            studyApi={{ open: schoolApi.flashcardOpen, review: schoolApi.flashcardReview, heartbeat: schoolApi.flashcardHeartbeat, summary: schoolApi.flashcardSummary }}
            resolveAssetUrl={schoolApi.flashcardAssetUrl ?? ((assetId) => assetId)}
            onExit={() => setActive(null)}
          />
        )}
        {active?.mode === 'problems' && <QuizRunner bank={active.bank} mode="drill" learning={active.learning} onExit={() => setActive(null)} />}
        {active?.mode === 'learning_probe' && (
          <LearningProbeRunner module={active.module} learning={active.learning} onExit={() => setActive(null)} />
        )}
        {active?.mode === 'learning_reader' && (
          <LearningContentReader module={active.module} onExit={() => setActive(null)} />
        )}
        {active?.mode === 'learning_unsupported' && (
          <section className="school-runner">
            <h2>{active.module.title ?? 'Interactive module'}</h2>
            <p>This module needs a capability that is not installed on this screen.</p>
            <button type="button" className="school-runner__done" onClick={() => setActive(null)}>Return to lesson</button>
          </section>
        )}
        {active?.mode === 'drill' && <GeoQuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'remediation' && currentUser && (
          <AdaptiveTutorPanel
            sessionId={active.sessionId}
            learnerId={currentUser.id}
            onExit={() => setActive(null)}
          />
        )}
        {active?.mode === 'lesson_companion' && active.descriptor.presentation === 'readalong' && (
          <ReadalongPlaylistPlayer
            title={active.descriptor.title}
            parts={active.descriptor.parts}
            progress={active.descriptor.state}
            onProgress={(payload) => schoolApi.companionProgress(active.descriptor.companionId, payload)}
            onExit={() => setActive(null)}
          />
        )}
        {/* A program mounted from the keypad has no header behind it (lock
            mode omits the whole header, apple included), so without this there
            is NO way back to the keypad — the never-dead-end rule, broken by
            the one action that opens a section rather than a runner. Runners
            carry their own onExit; a section does not.

            NOT ON A PREVIEW. `launch-preview:<payload>` is a section like any
            other as far as the router is concerned, so a locked Portal drew
            this over the preview card — a live, full-strength "Done" sitting on
            a screen whose own banner says nothing here is live, and the THIRD
            way off one screen after "Leave preview" and the card's "Go back".
            The preview already carries its exit in the band above the card,
            deliberately outside it, so the never-dead-end rule is satisfied
            without this: the honest fix is not to draw it. */}
        {lock.locked && section && !launchPreviewLink && !active && !courseId && (
          <button
            type="button"
            className="school-selfservice-card__action school-selfservice-card__action--exit school-app__locked-exit"
            data-testid="selfservice-section-exit"
            onClick={goHome}
          >
            Done
          </button>
        )}
        {/* Language study needs a claimed identity: every rung produces a
            record, and a guest's work is discarded. The program itself shows
            the sign-in prompt rather than drilling into a void. */}
        {courseId && studyLaunch
          && studyLaunch.corpusId === courseId
          && studyLaunch.learnerId === currentUser?.id && (
          <SentenceLadderProgram
            userId={studyLaunch.learnerId}
            corpusId={courseId}
            studyGrant={studyLaunch.studyGrant}
            onSignIn={lock.locked ? goHome : openPicker}
            onExit={lock.locked ? goHome : null}
            locked={lock.locked}
          />
        )}
        {previewCourseId && courses.some((course) => course.id === previewCourseId) && (
          <SentenceLadderProgram
            corpusId={previewCourseId}
            preview
            onExit={goHome}
          />
        )}
        {section === 'language-reels' && reelLaunch && reelLaunch.learnerId === currentUser?.id && (
          <LanguageReelsProgram
            userId={reelLaunch.learnerId}
            reelId={reelLaunch.reelId}
            reelGrant={reelLaunch.reelGrant}
            onExit={goHome}
          />
        )}
      </main>
      {/* No picker on a locked panel: the code already named the learner, and
          a face row is the one thing that WOULD put names on the lock screen.
          Nothing in lock mode calls openPicker() — the keypad and card never
          route through onLaunch's unclaimed branch. */}
      {!lock.locked && (
      <ProfilePicker
        open={pickerOpen}
        users={roster}
        activeId={currentUser?.id}
        onPick={onPick}
        onDismiss={onDismiss}
        onGuest={onGuest}
        guestLabel="Just practicing — continue as guest"
        timeoutMs={30000}
        title="Who's here?"
        showCountdown
      />
      )}
    </div>
  );
}

/**
 * Mounts two ways:
 *  - as a registered app via AppContainer, which passes `clear` to exit;
 *  - as the `school` screen widget, where it IS the screen (the Portal) and no
 *    `clear` exists because there is nothing behind it.
 *
 * `mode` / `idleTimeoutSeconds` / `screenOffTimeoutSeconds` normally come from
 * the screen's own `school:`
 * block, which `useSchoolLockMode` fetches — that is the live path. As props
 * they must be nested under a layout child's `props:` key, which is all
 * `PanelRenderer` spreads. Both absent is today, exactly: a browsable School.
 */
function SchoolShutdownGate(props) {
  const urlBase = useMemo(schoolUrlBase, []);
  const screenId = useMemo(() => screenIdFromUrlBase(urlBase), [urlBase]);
  const shutdown = useShutdownLock(`school:${screenId}`);
  if (shutdown.locked) return <ShutdownBlackout />;
  return <SchoolAppInner {...props} />;
}

function SchoolAppInner({
  clear,
  mode = null,
  idleTimeoutSeconds = null,
  screenOffTimeoutSeconds = null,
}) {
  return (
    <SchoolProfileProvider>
      <SchoolBreadcrumbProvider>
        <SchoolShell
          clear={clear}
          mode={mode}
          idleTimeoutSeconds={idleTimeoutSeconds}
          screenOffTimeoutSeconds={screenOffTimeoutSeconds}
        />
      </SchoolBreadcrumbProvider>
    </SchoolProfileProvider>
  );
}

export default function SchoolApp(props) { return <SchoolShutdownGate {...props} />; }
