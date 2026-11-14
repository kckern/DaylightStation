// Piano settings sheets harness: renders the real SoundPanel / OperatorDrawer
// against scene data (no backend). ?scene=<id>; see SCENES below.
import { createRoot } from 'react-dom/client';
import '../../../__app_modules/learning/piano/browser/tokens-style.mjs';
import '../../../__app_modules/learning/piano/browser/PianoApp.scss';
import { SUZUKI_MDG_400 } from '../../../__app_modules/learning/piano/browser/PianoKiosk/devices/suzukiMdg400.js';
import SoundPanel from '../../../__app_modules/learning/piano/browser/PianoKiosk/SoundPanel.jsx';
import OperatorDrawer from '../../../__app_modules/learning/piano/browser/PianoKiosk/OperatorDrawer.jsx';

const voice = (pc, name, bank = 0) => ({ pc, bank, name });
const GRAND = voice(0, 'Acoustic Grand');
const fx = { reverb: { type: 4, level: 64, on: true }, chorus: { type: 2, level: 0, on: false } };
const typed = {
  ...SUZUKI_MDG_400,
  effects: {
    reverb: { ...SUZUKI_MDG_400.effects.reverb, typeAddressable: true },
    chorus: { ...SUZUKI_MDG_400.effects.chorus, typeAddressable: true },
  },
};
const shortlist = [voice(0, 'Acoustic Grand'), voice(4, 'Electric Piano 1'), voice(19, 'Church Organ'), voice(40, 'Violin'), voice(73, 'Flute')];
const ready = { state: 'ready', copy: 'ready', input: { state: 'bridge', name: 'jam-7e6' }, output: { state: 'up', name: 'jam-7e6' }, bridge: { state: 'connected', unavailable: false } };
const down = { state: 'offline', copy: 'not connected', input: { state: 'down', name: null }, output: { state: 'down', name: null }, bridge: { state: 'reconnecting', unavailable: false } };
const maintConfig = { screensaver: { deviceId: 'piano-tablet' } };

const SCENES = {
  'sound-pianos': { sheet: 'sound', device: SUZUKI_MDG_400, bundle: { voice: GRAND, ...fx }, config: { shortlist: { voices: shortlist } }, health: ready, favorites: [{ voice: voice(73, 'Flute'), ...fx }] },
  'sound-mine': { sheet: 'sound', device: SUZUKI_MDG_400, bundle: { voice: voice(4, 'Electric Piano 1'), ...fx }, config: { shortlist: { voices: shortlist } }, health: ready, favorites: [{ voice: voice(4, 'Electric Piano 1'), ...fx }, { voice: voice(48, 'String Ensemble 1'), ...fx }], persistence: 'remembered' },
  'sound-winds': { sheet: 'sound', device: SUZUKI_MDG_400, bundle: { voice: voice(56, 'Trumpet'), reverb: { type: 4, level: 127, on: true }, chorus: { type: 2, level: 32, on: true } }, config: { shortlist: { voices: shortlist } }, health: ready, pianoLevel: 1 },
  'sound-voices': { sheet: 'sound', device: SUZUKI_MDG_400, bundle: { voice: voice(52, 'Choir Aahs'), ...fx }, config: { shortlist: { voices: shortlist } }, health: ready, pianoLevel: 0 },
  'sound-typed-offline': { sheet: 'sound', device: typed, bundle: { voice: voice(40, 'Violin'), reverb: { type: 4, level: 50, on: true }, chorus: { type: 2, level: 96, on: true } }, config: { shortlist: { voices: shortlist } }, health: down, canSave: false, pianoLevel: 0.6 },
  'sound-empty-mine': { sheet: 'sound', device: SUZUKI_MDG_400, bundle: { voice: voice(120, 'Guitar Fret Noise'), ...fx }, config: {}, health: ready, family: 'mine' },
  'maint-ready': { sheet: 'maint', health: ready, config: maintConfig },
  'maint-down': { sheet: 'maint', health: down, config: maintConfig, repair: { state: 'failed', message: 'Couldn’t reach the piano.' } },
};

const id = new URLSearchParams(window.location.search).get('scene') || 'sound-pianos';
window.__SCENE__ = SCENES[id];
// BluetoothPanel polls the tablet's audio bridge; answer with a fixed adapter.
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, adapter: { supported: true, enabled: true, discovering: false, name: 'Piano tablet' }, devices: [{ address: 'AA:BB', name: 'jam-7e6', bond: 'bonded', connected: { midi: true } }, { address: 'CC:DD', name: 'Living room speaker', bond: 'bonded', connected: {} }], pairing: null, lastError: null, capabilities: { scan: true, pair: true, unpair: true, audio: true, midi: true, pin: true, confirm: false } }) });

function App() {
  const scene = window.__SCENE__;
  if (!scene) return <p>Unknown scene {id}. Known: {Object.keys(SCENES).join(', ')}</p>;
  return <div className="piano-app" style={{ width: 1280, height: 800 }}>
    {scene.sheet === 'sound' ? <SoundPanel open onClose={() => {}} /> : <OperatorDrawer open onClose={() => {}} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
export const SCENE_IDS = Object.keys(SCENES);
