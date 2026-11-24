// Entry for sidebar.html: renders the sidebar scene alone (kept apart from
// main.jsx / scenes.jsx so it can be shot without touching the overlay scenes).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { sidebarScene } from './sidebarScene.jsx';

createRoot(document.getElementById('root')).render(
  <div className="harness-stage" style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a14', overflow: 'hidden' }}>
    {sidebarScene()}
  </div>
);
(async () => {
  try { await Promise.all(['400 16px "Roboto Condensed"', '600 16px "Roboto Condensed"'].map((f) => document.fonts.load(f))); await document.fonts.ready; } catch { /* no fonts API */ }
  await new Promise((r) => setTimeout(r, 1500));
  document.body.dataset.harnessReady = '1';
})();
