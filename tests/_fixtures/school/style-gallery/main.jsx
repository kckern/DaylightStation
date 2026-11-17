// School style gallery: mounts DOM snapshots of real activities (see
// snapshots.test.jsx) inside the real Portal surface + activity frame, with the
// real stylesheets, at device size. ?shot=<name> picks one snapshot.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchoolSurfaceProvider } from '../../../../__app_modules/learning/school/browser/portal/SchoolSurface.jsx';
import { SchoolActivityFrame } from '../../../../__app_modules/learning/school/browser/portal/SchoolActivityFrame.jsx';
import '../../../../__app_modules/learning/school/browser/School.scss';
import '../../../../__app_modules/learning/school/browser/Programs/Flashcards/FlashcardProgram.scss';
import '../../../../__app_modules/learning/school/browser/Programs/LanguageReels/LanguageReels.scss';
import '../../../../__app_modules/learning/school/browser/Programs/RubiksCube/RubiksCube.scss';
import '../../../../__app_modules/learning/school/browser/chess/ChessLessons.scss';
import '../../../../__app_modules/games/chess/browser/ChessBoard.scss';
import '../../../../frontend/src/lib/economy/GemBoard/GemBoard.scss';
import '../../../../__app_modules/learning/school/browser/rewards/RewardsModal.scss';
import '../../../../__app_modules/learning/school/browser/rewards/RewardsChest.scss';
import './gallery.scss';

const shots = import.meta.glob('./snapshots/*.html', { query: '?raw', import: 'default', eager: true });
const name = new URLSearchParams(location.search).get('shot') ?? 'flashcards-front';
const html = shots[`./snapshots/${name}.html`] ?? `<p>No snapshot named ${name}</p>`;
const overlay = name.startsWith('rewards');

function App() {
  return <SchoolSurfaceProvider surfaceId="gallery" deviceId="gallery">
    <div className="school-app">
      {overlay
        ? <div dangerouslySetInnerHTML={{ __html: html }} />
        : <SchoolActivityFrame layout="workspace" className="school-activity--adapter"><div dangerouslySetInnerHTML={{ __html: html }} /></SchoolActivityFrame>}
    </div>
  </SchoolSurfaceProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
