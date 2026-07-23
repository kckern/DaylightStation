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
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import SchoolHome from './home/SchoolHome.jsx';
import SubjectPage from './home/SubjectPage.jsx';
import LibraryPage from './home/LibraryPage.jsx';
import PrintCenter from './print/PrintCenter.jsx';
import TypingTutor from './Typing/TypingTutor.jsx';
import Icon from './home/icons/Icon.jsx';
import { SchoolBreadcrumbProvider, useSchoolBreadcrumbBar } from './SchoolBreadcrumbContext.jsx';
import { groupBySubject, subjectLabel } from './home/subjects.js';
import GlossikaProgram from './Programs/Glossika/GlossikaProgram.jsx';
import ReportPanel from './report/ReportPanel.jsx';
import { languageApi } from './Programs/Glossika/languageApi.js';
import { schoolApi } from './schoolApi.js';
import { schoolLog } from './schoolLog.js';
import './School.scss';

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
 *   <base>/progress | /practice | /print | /typing | /lang/<courseId>
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

// Everything after a `subject/<id>` or `library` section is the MATERIALS
// CHAIN — the raw id segments the breadcrumb descends through (collection →
// work → track, or show → episode). So the URL matches the breadcrumb all the
// way down, and a leaf like `…/plex:483194/plex:483214/plex:483215` deep-links
// straight to a playing track. Ids (`plex:<key>`) are valid path segments.
export function parseSchoolPath(urlBase) {
  const empty = { section: null, materialPath: [] };
  if (!urlBase) return empty;
  const seg = window.location.pathname.slice(urlBase.length).split('/').filter(Boolean).map(decodeURIComponent);
  if (!seg.length) return empty;
  if (seg[0] === 'subject' && seg[1]) return { section: `subject:${seg[1]}`, materialPath: seg.slice(2) };
  if (seg[0] === 'library') return { section: 'library', materialPath: seg.slice(1) };
  if (seg[0] === 'progress') return { section: 'progress', materialPath: [] };
  if (seg[0] === 'practice') return { section: 'banks', materialPath: [] };
  if (seg[0] === 'print') return { section: 'print', materialPath: [] };
  if (seg[0] === 'typing') return { section: 'typing', materialPath: [] };
  if (seg[0] === 'lang' && seg[1]) return { section: `lang:${seg[1]}`, materialPath: [] };
  return empty;
}

function sectionPathFor(urlBase, section) {
  if (section === null) return urlBase;
  if (section.startsWith('subject:')) return `${urlBase}/subject/${encodeURIComponent(section.slice(8))}`;
  if (section === 'library') return `${urlBase}/library`;
  if (section === 'progress') return `${urlBase}/progress`;
  if (section === 'banks') return `${urlBase}/practice`;
  if (section === 'print') return `${urlBase}/print`;
  if (section === 'typing') return `${urlBase}/typing`;
  if (section.startsWith('lang:')) return `${urlBase}/lang/${encodeURIComponent(section.slice(5))}`;
  return urlBase;
}

// Full path = the section path + the materials chain (subject/library only).
export function schoolPathFor(urlBase, section, materialPath = []) {
  const base = sectionPathFor(urlBase, section);
  const carriesChain = section && (section.startsWith('subject:') || section === 'library');
  if (!carriesChain || !materialPath.length) return base;
  return `${base}/${materialPath.map(encodeURIComponent).join('/')}`;
}

function SchoolShell({ clear }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, claim, continueAsGuest } = useSchoolProfile();
  const { crumbs: extraCrumbs } = useSchoolBreadcrumbBar();
  const urlBase = useMemo(schoolUrlBase, []);
  const initialLink = useMemo(() => parseSchoolPath(urlBase), [urlBase]);
  const [section, setSection] = useState(initialLink.section); // a sections id, or null = home grid
  // The materials chain below the section (collection → work → track ids). It
  // is both the DEEP-LINK input MaterialsSection restores from on entry and the
  // live nav state it reports back so the URL stays in lock-step with the
  // breadcrumb all the way down to a playing track.
  const [materialPath, setMaterialPath] = useState(initialLink.materialPath);
  const [active, setActive] = useState(null);   // {bank, mode} — only ever set within 'banks'
  const [pending, setPending] = useState(null); // {bankSummary, mode} awaiting a claim
  const [notice, setNotice] = useState(null);
  const [materials, setMaterials] = useState([]); // full catalog materials list, unfiltered
  const [courses, setCourses] = useState([]);     // language courses (Glossika)
  const [banks, setBanks] = useState([]);         // bank summaries, for shelving + titles

  // Fetch all three catalogues once the profile roster is ready — the home's
  // subject shelves are grouped from whatever actually resolved. Any one
  // failing simply leaves its content absent (an emptier shelf), never a
  // broken panel: the home must render on a dead catalog.
  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    Promise.all([schoolApi.materials(), languageApi.courses(), schoolApi.banks()]).then(([mat, lang, bnk]) => {
      if (!alive) return;
      if (!mat.ok || !mat.data) schoolLog.materials('catalog-failed', { ok: mat.ok });
      setMaterials(mat.ok && Array.isArray(mat.data?.materials) ? mat.data.materials : []);
      setCourses(lang.ok && Array.isArray(lang.data) ? lang.data : []);
      setBanks(bnk.ok && Array.isArray(bnk.data) ? bnk.data : []);
    });
    return () => { alive = false; };
  }, [status]);

  // The nine shelves + the Library, from the three catalogues.
  const grouped = useMemo(
    () => groupBySubject({ materials, banks, courses }),
    [materials, banks, courses],
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

  // Going home also clears any guest-refusal notice: the notice belongs to
  // the section visit that produced it and must not greet the next visit.
  const goHome = useCallback(() => {
    setSection(null);
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
  }, [currentUser, isGuest]);

  const subjectId = section?.startsWith('subject:') ? section.slice(8) : null;
  const courseId = section?.startsWith('lang:') ? section.slice(5) : null;
  const sectionLabel = !section ? null
    : subjectId ? subjectLabel(subjectId)
      : section === 'library' ? 'Library'
        : section === 'progress' ? 'My Progress'
          : section === 'banks' ? 'Practice'
            : section === 'print' ? 'Print'
              : section === 'typing' ? 'Typing'
                : courseId ? (courses.find((c) => c.id === courseId)?.label ?? 'Language')
                  : section;

  // The header trail past the apple home anchor. Deep material routes publish
  // their own full sub-trail (section crumb → material → unit, each with its
  // own handler) via the breadcrumb bus; when none is published, the trail is
  // just the current section as a non-navigable current crumb.
  const breadcrumbTrail = extraCrumbs && extraCrumbs.length
    ? extraCrumbs
    : (section ? [{ label: sectionLabel }] : []);

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
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
            onClick={() => (section || active ? goHome() : (clear ? clear() : undefined))}
            aria-label={section || active ? 'Home' : 'School'}
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
      </header>
      <main className="school-app__body">
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
        {section === 'progress' && <ReportPanel userId={currentUser?.id || null} />}
        {section === 'print' && <PrintCenter />}
        {section === 'typing' && <TypingTutor />}
        {section === 'banks' && !active && <BankBrowser guestOnly={isGuest} onLaunch={onLaunch} notice={notice} />}
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
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
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
      <SchoolBreadcrumbProvider>
        <SchoolShell clear={clear} />
      </SchoolBreadcrumbProvider>
    </SchoolProfileProvider>
  );
}
