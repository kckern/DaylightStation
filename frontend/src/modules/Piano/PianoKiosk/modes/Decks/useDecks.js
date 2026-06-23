import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import jsyaml from 'js-yaml';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { DecksEngine } from './decksEngine.js';

const DJ_ROOT = 'audio/dj';
const streamUrl = (rel) => `/api/v1/local/stream/${rel}`;

/**
 * Decks data + audio engine. Discovers kits under media/audio/dj (each a folder
 * with a kit.yml + loops/ + oneshots/), loads the selected kit's samples into the
 * Web Audio engine, and exposes pad triggers. The AudioContext resumes on the
 * first user gesture (any pad/key), satisfying browser autoplay policy.
 */
export function useDecks() {
  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = new DecksEngine();
  const engine = engineRef.current;
  const logger = useMemo(() => getLogger().child({ component: 'piano-decks' }), []);

  const [kits, setKits] = useState(null);   // null = discovering
  const [kitId, setKitId] = useState(null);
  const [kit, setKit] = useState(null);     // parsed manifest of the loaded kit
  const [ready, setReady] = useState(false);
  const [loopOn, setLoopOn] = useState(() => new Set());
  const [error, setError] = useState(null);

  // Discover kit folders.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await DaylightAPI(`api/v1/local/browse/${DJ_ROOT}`);
        const found = (res.items || [])
          .filter((i) => i.type === 'directory')
          .map((i) => ({ id: i.title, path: i.localId }));
        if (!cancelled) { setKits(found); setKitId(found[0]?.id ?? null); }
        logger.info('piano.decks.discovered', { count: found.length });
      } catch (e) {
        if (!cancelled) { setKits([]); setError(e.message); }
        logger.warn('piano.decks.discover-failed', { error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [logger]);

  // Load the selected kit (manifest + decode samples).
  useEffect(() => {
    if (!kitId || !kits) return undefined;
    const meta = kits.find((k) => k.id === kitId);
    if (!meta) return undefined;
    let cancelled = false;
    setReady(false); setKit(null); setError(null);
    (async () => {
      try {
        const text = await (await fetch(streamUrl(`${meta.path}/kit.yml`))).text();
        const parsed = jsyaml.load(text);
        if (!cancelled) { setKit(parsed); setLoopOn(new Set()); } // show pads immediately
        await engine.loadKit(parsed, (rel) => streamUrl(`${meta.path}/${rel}`));
        if (!cancelled) setReady(true); // enable once samples are decoded
        logger.info('piano.decks.kit-loaded', { kit: meta.id, bpm: parsed?.bpm });
      } catch (e) {
        if (!cancelled) setError(e.message);
        logger.warn('piano.decks.kit-failed', { kit: meta.id, error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [kitId, kits, engine, logger]);

  // Tear down the AudioContext on unmount.
  useEffect(() => () => engine.dispose(), [engine]);

  const playOneShot = useCallback((id) => { engine.playOneShot(id); }, [engine]);
  const toggleLoop = useCallback((id) => {
    const on = engine.toggleLoop(id);
    setLoopOn((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    logger.info('piano.decks.loop', { id, on });
  }, [engine, logger]);
  const stopAll = useCallback(() => { engine.stopAll(); setLoopOn(new Set()); }, [engine]);

  return { kits, kitId, setKitId, kit, ready, loopOn, error, playOneShot, toggleLoop, stopAll, playing: loopOn.size > 0 };
}

export default useDecks;
