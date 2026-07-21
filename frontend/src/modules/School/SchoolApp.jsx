/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns the picker-flow: launching tracked work while unclaimed opens
 * the ProfilePicker with the launch pending (spec §6 — claim prompt on
 * tracked work; browsing never prompts).
 */
import { useCallback, useState } from 'react';
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

  const start = useCallback(async (bankSummary, mode, asGuest) => {
    if (asGuest && bankSummary.audience !== 'generic') {
      setNotice('Sign in to take this one — guests get the practice sets.');
      return;
    }
    const { ok, data } = await schoolApi.bank(bankSummary.id);
    if (ok) { setNotice(null); setActive({ bank: data, mode }); }
  }, []);

  const onLaunch = useCallback((bankSummary, mode) => {
    if (!currentUser && !isGuest) {
      setPending({ bankSummary, mode });
      openPicker();
      return;
    }
    start(bankSummary, mode, isGuest);
  }, [currentUser, isGuest, openPicker, start]);

  const onPick = useCallback((id) => {
    claim(id);
    if (pending) { start(pending.bankSummary, pending.mode, false); setPending(null); }
  }, [claim, pending, start]);

  const onDismiss = useCallback(() => {
    continueAsGuest();
    if (pending) { start(pending.bankSummary, pending.mode, true); setPending(null); }
  }, [continueAsGuest, pending, start]);

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
      <header className="school-app__header">
        <button type="button" className="school-app__back" aria-label="Exit school" onClick={() => (active ? setActive(null) : clear())}>‹</button>
        <h1 className="school-app__title">School</h1>
        <button type="button" className="school-app__chip" onClick={openPicker}>
          {currentUser
            ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
            : <span>{isGuest ? 'Guest' : 'Tap to sign in'}</span>}
        </button>
      </header>
      <main className="school-app__body">
        {!active && <BankBrowser guestOnly={isGuest || !currentUser} onLaunch={onLaunch} notice={notice} />}
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
      </main>
      <ProfilePicker open={pickerOpen} users={roster} activeId={currentUser?.id} onPick={onPick} onDismiss={onDismiss} timeoutMs={30000} title="Who's here?" />
    </div>
  );
}

export default function SchoolApp({ clear }) {
  return (
    <SchoolProfileProvider>
      <SchoolShell clear={clear} />
    </SchoolProfileProvider>
  );
}
