// usePianoMix.js — the hook half of PianoMixContext.jsx, split out so Fast
// Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import Ctx from './PianoMixContext.jsx';

export const usePianoMix = () => useContext(Ctx);
