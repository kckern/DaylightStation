import React from 'react';
import { createRoot } from 'react-dom/client';
import { SCENES } from './scenes.jsx';

const READY_SETTLE_MS = 600; // entry transitions, first avatar paint

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) {
    console.error(`harness: scene threw: ${err?.stack || err}`);
    document.body.dataset.harnessError = String(err?.message || err);
  }
  render() {
    if (this.state.err) return <pre style={{ color: '#f66', padding: 24 }}>{String(this.state.err.stack || this.state.err)}</pre>;
    return this.props.children;
  }
}

// Stand-in for a paused workout video: a gradient plus big faint HUD text, so an
// overlay that lets the video show through (or fails to cover it) is visible.
const PausedVideo = () => (
  <div data-harness-backdrop="" aria-hidden="true" style={{
    position: 'absolute', inset: 0, overflow: 'hidden',
    background: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 45%, #ffaf7b 100%)',
  }}>
    <div style={{ position: 'absolute', left: 60, top: 40, font: '700 140px/1 sans-serif', color: 'rgba(255,255,255,0.22)' }}>142 BPM</div>
    <div style={{ position: 'absolute', right: 60, top: 60, font: '700 96px/1 sans-serif', color: 'rgba(255,255,255,0.22)' }}>12:47</div>
    <div style={{ position: 'absolute', left: 80, bottom: 120, font: '800 180px/1 sans-serif', color: 'rgba(0,0,0,0.18)' }}>PLYO CARDIO</div>
    <div style={{ position: 'absolute', right: 80, bottom: 60, font: '600 64px/1 sans-serif', color: 'rgba(255,255,255,0.25)' }}>❚❚ paused</div>
  </div>
);

const name = new URLSearchParams(window.location.search).get('scene');
const scene = SCENES[name];
const root = createRoot(document.getElementById('root'));

if (!scene) {
  console.error(`harness: unknown scene "${name}". Known: ${Object.keys(SCENES).join(', ')}`);
  document.body.dataset.harnessError = 'unknown scene';
} else {
  // The stage is the viewport (default 1810x1080 = the kiosk content area beside
  // the nav rail). position:fixed overlays (the voice memo portal) cover the same box.
  root.render(
    <Boundary>
      <div className="harness-stage fitness-player-content" data-scene={name}
        style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a14', overflow: 'hidden' }}>
        <PausedVideo />
        {scene.render()}
      </div>
    </Boundary>
  );
  const imagesSettled = () => Promise.all([...document.images].map((img) => (
    img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })
  )));
  (async () => {
    try {
      // Load the app font explicitly so the shot never catches a fallback face.
      await Promise.all(['400 16px "Roboto Condensed"', '600 16px "Roboto Condensed"'].map((f) => document.fonts.load(f)));
      if (!document.fonts.check('400 16px "Roboto Condensed"')) document.body.dataset.harnessError = 'Roboto Condensed did not load';
      await document.fonts.ready;
    } catch { /* fonts API absent */ }
    await new Promise((r) => setTimeout(r, 200));
    await imagesSettled();
    await new Promise((r) => setTimeout(r, READY_SETTLE_MS));
    if (document.body.dataset.harnessError) return;
    document.body.dataset.harnessReady = '1';
  })();
}
