/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns two navigation levels: the home section grid (spec §8), and
 * — inside the banks section — the picker-flow: launching tracked work while
 * unclaimed opens the ProfilePicker with the launch pending (spec §6 — claim
 * prompt on tracked work; browsing never prompts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ProfilePicker from '../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../lib/identity/ProfileAvatar.jsx';
import { SchoolProfileProvider, useSchoolProfile } from './identity/SchoolProfileContext.jsx';
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import SectionGrid from './home/SectionGrid.jsx';
import LearnerHome from './home/LearnerHome.jsx';
import { SECTIONS, sectionsFromCatalog } from './home/sections.js';
import MaterialsSection from './materials/MaterialsSection.jsx';
import GlossikaProgram from './Programs/Glossika/GlossikaProgram.jsx';
import ReportPanel from './report/ReportPanel.jsx';
import { languageApi } from './Programs/Glossika/languageApi.js';
import { schoolApi } from './schoolApi.js';
import { schoolLog } from './schoolLog.js';
import './School.scss';

function SchoolShell({ clear }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, claim, continueAsGuest } = useSchoolProfile();
  const [section, setSection] = useState(null); // a sections id, or null = home grid
  const [active, setActive] = useState(null);   // {bank, mode} — only ever set within 'banks'
  const [pending, setPending] = useState(null); // {bankSummary, mode} awaiting a claim
  const [notice, setNotice] = useState(null);
  const [sections, setSections] = useState(SECTIONS); // built-ins, + catalog sections once fetched
  const [materials, setMaterials] = useState([]);      // full catalog materials list, unfiltered

  // Fetch the materials catalog once the profile roster is ready, so the
  // catalog-driven category tiles (Courses/Reference/Listening) join the
  // home grid alongside the built-ins. A failure (network, non-ok, or the
  // materials config not yet shipped -> {sections:[],materials:[]}) simply
  // leaves the built-ins as the whole grid -- the panel must never break on
  // a missing/failed catalog.
  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    // Both catalogues are fetched together so the grid is built once, from
    // whatever actually resolved. Either failing leaves its tiles absent
    // rather than breaking the panel.
    Promise.all([schoolApi.materials(), languageApi.courses()]).then(([mat, lang]) => {
      if (!alive) return;
      const catalogSections = mat.ok && mat.data ? mat.data.sections : [];
      const languageCourses = lang.ok && Array.isArray(lang.data) ? lang.data : [];
      if (!mat.ok || !mat.data) schoolLog.materials('catalog-failed', { ok: mat.ok });
      setSections(sectionsFromCatalog(catalogSections, languageCourses));
      setMaterials(mat.ok && Array.isArray(mat.data?.materials) ? mat.data.materials : []);
    });
    return () => { alive = false; };
  }, [status]);
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
    if (ok) { setNotice(null); setActive({ bank: data, mode }); }
  }, []);

  // Returns the in-flight promise (rather than firing-and-forgetting) so a
  // caller — BankBrowser's double-tap guard — can await completion before
  // re-arming, the same async-guard convention as FlashcardRunner's grade().
  const onLaunch = useCallback(async (bankSummary, mode) => {
    if (!currentUser && !isGuest) {
      setPending({ bankSummary, mode });
      openPicker();
      return;
    }
    await start(bankSummary, mode, isGuest);
  }, [currentUser, isGuest, openPicker, start]);

  const onPick = useCallback((id) => {
    claim(id);
    if (pending) { start(pending.bankSummary, pending.mode, false); setPending(null); }
  }, [claim, pending, start]);

  const onDismiss = useCallback(() => {
    continueAsGuest();
    if (pending) { start(pending.bankSummary, pending.mode, true); setPending(null); }
  }, [continueAsGuest, pending, start]);

  const openSection = useCallback((id) => {
    setSection(id);
    schoolLog.nav('section', { section: id });
  }, []);

  // Going home also clears any guest-refusal notice: the notice belongs to
  // the section visit that produced it and must not greet the next visit.
  const goHome = useCallback(() => {
    setSection(null);
    setNotice(null);
    schoolLog.nav('home', {});
  }, []);

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
  }, [currentUser, isGuest]);

  const sectionDef = section ? sections.find((s) => s.id === section) : null;
  const category = section?.startsWith('cat:') ? section.slice(4) : null;
  const courseId = section?.startsWith('lang:') ? section.slice(5) : null;

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
      <header className="school-app__header">
        {/* Back steps one navigation level: runner -> bank list -> home ->
            exit. The last hop only exists when School is mounted as an app
            (AppContainer passes `clear`); when School IS the screen (the
            `school` widget — the Portal's whole purpose) there is nowhere to
            exit TO, so at home the control is omitted entirely rather than
            rendering a dead button on a touch-only panel. */}
        {(active || section || clear) && (
          <button
            type="button"
            className="school-app__back"
            aria-label={active ? 'Back to bank list' : section ? 'Back to home' : 'Exit school'}
            onClick={() => (active ? setActive(null) : section ? goHome() : clear())}
          >
            ‹
          </button>
        )}
        <h1 className="school-app__title">{sectionDef ? sectionDef.label : 'School'}</h1>
        <button type="button" className="school-app__chip" onClick={openPicker}>
          {currentUser
            ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
            : <span>{isGuest ? 'Guest' : 'Tap to sign in'}</span>}
        </button>
      </header>
      <main className="school-app__body">
        {/* Claimed: a home built around this learner's next step. Unclaimed:
            the roster itself is the front door — tapping your own face is the
            entry gesture, and a personal dashboard for nobody is meaningless.
            An explicit guest still browses, which is the pre-existing rule
            that browsing never prompts. */}
        {!section && currentUser && (
          <LearnerHome
            user={currentUser}
            sections={sections}
            onOpen={openSection}
            onSwitchProfile={openPicker}
          />
        )}
        {!section && !currentUser && (
          <div className="school-home school-home--unclaimed">
            <h2 className="school-home__greeting">Who&apos;s here?</h2>
            <button type="button" className="school-home__claim" onClick={openPicker}>
              Choose your face
            </button>
            <SectionGrid sections={sections} onOpen={openSection} compact />
          </div>
        )}
        {/* Only an EXPLICIT guest (continueAsGuest()) is restricted to the
            generic catalogue. An unclaimed child has not declined identity --
            they simply have not picked yet -- so they see everything and get
            prompted only when they try to launch tracked work (onLaunch
            above). Bank reads are ungated by design; real enforcement is
            server-side at session open (403 for guest vs an assigned bank). */}
        {/* Opens on the signed-in learner when there is one, otherwise the
            whole household. Both scopes are the same endpoint, filtered. */}
        {section === 'progress' && <ReportPanel userId={currentUser?.id || null} />}
        {section === 'banks' && !active && <BankBrowser guestOnly={isGuest} onLaunch={onLaunch} notice={notice} />}
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
        {category && (
          <MaterialsSection
            materials={materials.filter((m) => m.category === category)}
            sectionLabel={sectionDef?.label}
          />
        )}
        {/* Language study needs a claimed identity: every rung produces a
            record, and a guest's work is discarded. The program itself shows
            the sign-in prompt rather than drilling into a void. */}
        {courseId && (
          <GlossikaProgram
            userId={currentUser?.id || null}
            corpusId={courseId}
            onSignIn={openPicker}
          />
        )}
      </main>
      <ProfilePicker open={pickerOpen} users={roster} activeId={currentUser?.id} onPick={onPick} onDismiss={onDismiss} timeoutMs={30000} title="Who's here?" />
    </div>
  );
}

/**
 * Mounts two ways:
 *  - as a registered app via AppContainer, which passes `clear` to exit;
 *  - as the `school` screen widget, where it IS the screen (the Portal) and no
 *    `clear` exists because there is nothing behind it.
 */
export default function SchoolApp({ clear }) {
  return (
    <SchoolProfileProvider>
      <SchoolShell clear={clear} />
    </SchoolProfileProvider>
  );
}
