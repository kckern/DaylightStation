import React from 'react';
import { createRoot } from 'react-dom/client';
import { SCENES } from './scenes.jsx';

const READY_SETTLE_MS = 1500; // chart tweens, stagger animations, first WebGL frames

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

const name = new URLSearchParams(window.location.search).get('scene');
const scene = SCENES[name];
const root = createRoot(document.getElementById('root'));

if (!scene) {
  console.error(`harness: unknown scene "${name}". Known: ${Object.keys(SCENES).join(', ')}`);
  document.body.dataset.harnessError = 'unknown scene';
} else {
  root.render(
    <Boundary>
      <div className="harness-stage" data-scene={name}
        style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a14', overflow: 'hidden' }}>
        {scene.render()}
      </div>
    </Boundary>
  );
  const imagesSettled = () => Promise.all([...document.images].map((img) => (
    img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })
  )));
  (async () => {
    try { await document.fonts?.ready; } catch { /* fonts API absent */ }
    await new Promise((r) => setTimeout(r, 300));
    await imagesSettled();
    await new Promise((r) => setTimeout(r, READY_SETTLE_MS));
    if (document.body.dataset.harnessError) return;
    document.body.dataset.harnessCanvas = document.querySelector('canvas') ? 'yes' : 'no';
    document.body.dataset.harnessReady = '1';
  })();
}
