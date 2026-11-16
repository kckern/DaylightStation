import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolSurfaceProvider } from '../../../../__app_modules/learning/school/browser/portal/SchoolSurface.jsx';
import { SchoolActivityFrame } from '../../../../__app_modules/learning/school/browser/portal/SchoolActivityFrame.jsx';
import { SchoolButton } from '../../../../__app_modules/learning/school/browser/portal/SchoolButton.jsx';
import { SchoolSelect } from '../../../../__app_modules/learning/school/browser/portal/SchoolSelect.jsx';
import { useSchoolCommands } from '../../../../__app_modules/learning/school/browser/portal/useSchoolCommands.js';
import TypingTutor from '../../../../__app_modules/learning/school/browser/Typing/TypingTutor.jsx';
import CardLadderStage from '../../../../__app_modules/learning/school/browser/Programs/Flashcards/CardLadder/CardLadderStage.jsx';
import RewardsModal from '../../../../__app_modules/learning/school/browser/rewards/RewardsModal.jsx';
import '../../../../__app_modules/learning/school/browser/School.scss';
import '../../../../__app_modules/learning/school/browser/Programs/Flashcards/CardLadder/CardLadder.scss';
import './fixture.scss';

const snapshot = { learnerId: 'fixture', mode: 'live', silver: 12, gold: 3, rings: 40, groups: [], gems: [] };
function Commands({ name }) {
  const [count, setCount] = useState(0);
  useSchoolCommands({ f8: () => setCount(value => value + 1) });
  return <output aria-label={`${name} commands`}>{count}</output>;
}
function Main() {
  const [layout, setLayout] = useState('workspace');
  const [activity, setActivity] = useState('typing');
  const [modal, setModal] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  const [exits, setExits] = useState(0);
  return <>
    <div className="fixture-toolbar">
      <label>Layout <SchoolSelect aria-label="Layout" density="compact" value={layout} onChange={event => setLayout(event.target.value)}>{['workspace', 'focus', 'split', 'media', 'board'].map(value => <option key={value}>{value}</option>)}</SchoolSelect></label>
      <label>Activity <SchoolSelect aria-label="Activity" density="compact" value={activity} onChange={event => setActivity(event.target.value)}><option value="typing">Typing</option><option value="board">Fixed stage</option></SchoolSelect></label>
      <span>Exits <output aria-label="Exits">{exits}</output></span>
    </div>
    <SchoolActivityFrame layout={layout} title="School studio" onDone={() => setExits(value => value + 1)} progress={<progress aria-label="Progress" value="1" max="3" />} actions={<><SchoolButton busy>Saving</SchoolButton><SchoolButton variant="secondary" onClick={() => setModal(true)}>Rewards</SchoolButton></>}>
      {activity === 'typing' ? <TypingTutor /> : <CardLadderStage><div className="fixture-board" aria-label="Fixed reference board">{Array.from({ length: 64 }, (_, index) => <span key={index}>{index + 1}</span>)}</div></CardLadderStage>}
      {activity === 'typing' && <form onSubmit={event => { event.preventDefault(); setSubmitted(value => value + 1); }}>
        <label>Answer <input aria-label="Answer" /></label><SchoolButton density="compact" type="submit">Submit</SchoolButton><output aria-label="Submissions">{submitted}</output>
      </form>}
    </SchoolActivityFrame>
    <div className="fixture-status">Main command F8 <Commands name="Main" /></div>
    {modal && <RewardsModal learner={{ id: 'fixture', name: 'Fixture learner' }} snapshot={snapshot} idleMs={0} onClose={() => setModal(false)} />}
  </>;
}
function Cell() {
  return <SchoolActivityFrame title="Constrained panel" className="fixture-cell-frame"><SchoolButton density="compact" variant="secondary">Activate panel</SchoolButton><p>Panel command F8 <Commands name="Panel" /></p><div className="fixture-large">A large workspace remains scrollable inside this panel.</div></SchoolActivityFrame>;
}
function App() {
  return <SchoolSurfaceProvider surfaceId="fixture" density="compact"><div className="fixture-shell">
    <main className="fixture-main"><SchoolSurfaceProvider surfaceId="main" deviceId="fixture-main"><Main /></SchoolSurfaceProvider></main>
    <aside className="fixture-cell"><SchoolSurfaceProvider surfaceId="panel" deviceId="fixture-panel" density="compact"><Cell /></SchoolSurfaceProvider></aside>
  </div></SchoolSurfaceProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
