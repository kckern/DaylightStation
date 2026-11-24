import React from 'react';
import { createRoot } from 'react-dom/client';
import { wsService } from '../../../../frontend/src/services/WebSocketService.js';
import { ScreenOverlayProvider } from '../../../../__capabilities/screen-host/browser/overlays.mjs';
import { PianoVisualizer } from '../../../../__app_modules/learning/piano/browser/PianoVisualizer.jsx';

// No backend here: the bus never connects, and must not reload the page for it.
wsService.suppressAutoReload('office-sheet-music-fixture');

// The piano, as the recorder sends it over the `midi` topic.
const send = (event, note, velocity = 0) => wsService._dispatch({ topic: 'midi', type: 'note', data: { event, note, velocity } });
window.__officeMidi = {
  press: (note, velocity = 80) => send('note_on', note, velocity),
  release: (note) => send('note_off', note, 0),
  pedal: (value) => wsService._dispatch({ topic: 'midi', type: 'control', data: { event: 'control_change', control: 64, controlName: 'sustain', value, channel: 0 } }),
};

createRoot(document.getElementById('root')).render(
  <ScreenOverlayProvider>
    <PianoVisualizer onClose={() => {}} onSessionEnd={() => {}} />
  </ScreenOverlayProvider>,
);
