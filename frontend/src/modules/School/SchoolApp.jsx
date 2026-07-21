/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns the picker-flow: launching tracked work while unclaimed opens
 * the ProfilePicker with the launch pending (spec §6 — claim prompt on
 * tracked work; browsing never prompts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ProfilePicker from '../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../lib/identity/ProfileAvatar.jsx';
import { SchoolProfileProvider, useSchoolProfile } from './identity/SchoolProfileContext.jsx';
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import { schoolApi } from './schoolApi.js';
import './School.scss';

function SchoolShell({ clear }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, claim, continueAsGuest } = useSchoolProfile();
  const [active, setActive] = useState(null);   // {bank, mode}
  const [pending, setPending] = useState(null); // {bankSummary, mode} awaiting a claim
  const [notice, setNotice] = useState(null);
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

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
      <header className="school-app__header">
        {/* Back has two meanings, and on the Portal it sometimes has none.
            Inside a running bank it steps back to the list. Otherwise it exits
            the app -- but when School IS the screen (mounted as the `school`
            widget, the Portal's whole purpose) there is nowhere to exit TO, so
            `clear` is absent and the control is omitted entirely rather than
            rendering a dead button on a touch-only panel. */}
        {(active || clear) && (
          <button
            type="button"
            className="school-app__back"
            aria-label={active ? 'Back to bank list' : 'Exit school'}
            onClick={() => (active ? setActive(null) : clear())}
          >
            ‹
          </button>
        )}
        <h1 className="school-app__title">School</h1>
        <button type="button" className="school-app__chip" onClick={openPicker}>
          {currentUser
            ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
            : <span>{isGuest ? 'Guest' : 'Tap to sign in'}</span>}
        </button>
      </header>
      <main className="school-app__body">
        {/* Only an EXPLICIT guest (continueAsGuest()) is restricted to the
            generic catalogue. An unclaimed child has not declined identity --
            they simply have not picked yet -- so they see everything and get
            prompted only when they try to launch tracked work (onLaunch
            below). Bank reads are ungated by design; real enforcement is
            server-side at session open (403 for guest vs an assigned bank). */}
        {!active && <BankBrowser guestOnly={isGuest} onLaunch={onLaunch} notice={notice} />}
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
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
