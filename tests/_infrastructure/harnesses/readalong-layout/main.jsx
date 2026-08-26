// Readalong layout harness: mounts the REAL shell inside a replica of the
// Portal's screen-framework ancestry (screen-root 1280x800 → screen-panel →
// screen-widget--full → school-app--locked → school-app__body), exactly as
// captured from the live tablet DOM.
import { createRoot } from 'react-dom/client';
import ReadalongPlaylistPlayer from '../../../../frontend/src/modules/Player/ReadalongPlaylistPlayer.jsx';
import '../../../../frontend/src/screen-framework/panels/PanelRenderer.css';
import '../../../../frontend/src/modules/School/School.scss';

const parts = [
  { id: 'p1', title: 'Psalms 49', contentId: 'readalong:scripture/fixture-ps-49' },
  { id: 'p2', title: 'Psalms 50', contentId: 'readalong:scripture/fixture-ps-50' },
  { id: 'p3', title: 'Psalms 51', contentId: 'readalong:scripture/fixture-ps-51' },
  { id: 'p4', title: 'Psalms 61', contentId: 'readalong:scripture/fixture-ps-61' },
];

createRoot(document.getElementById('root')).render(
  <div className="screen-root" style={{ width: '1280px', height: '800px', display: 'flex', position: 'relative', overflow: 'hidden' }}>
    <div className="screen-panel" style={{ flex: '1 1 auto', height: '100%', boxSizing: 'border-box' }}>
      <div className="screen-widget screen-widget--full" style={{ flex: '1 1 auto' }}>
        <div className="school-app school-app--locked">
          <main className="school-app__body">
            <ReadalongPlaylistPlayer
              title="Psalms 49; 50; 51; 61"
              parts={parts}
              progress={{}}
              onProgress={() => {}}
              onExit={() => {}}
            />
          </main>
        </div>
      </div>
    </div>
  </div>
);
