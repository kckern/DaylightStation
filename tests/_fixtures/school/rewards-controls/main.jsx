import React, { useState, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import RewardsModal from '../../../../__app_modules/learning/school/browser/rewards/RewardsModal.jsx';

const learner = { id: 'one', name: 'One' };
const snapshot = {
  learnerId: 'one', mode: 'live', silver: 24, gold: 3, rings: 1260, groups: [],
  gems: [{ id: 'g', label: 'Gem', group: 'school', color: '#f2c94c', cell: { state: 'earned', week: 1 } }],
};

function App() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  useLayoutEffect(() => { document.querySelector('#under').focus(); setOpen(true); }, []);
  return <>
    <button id="under" style={{ position: 'fixed', right: '3vw', top: '3vh', width: 100, height: 100 }} onClick={() => setCount(n => n + 1)}>Log book {count}</button>
    {open && <RewardsModal learner={learner} snapshot={snapshot} onClose={() => setOpen(false)} idleMs={0} />}
  </>;
}
createRoot(document.getElementById('root')).render(<App />);
