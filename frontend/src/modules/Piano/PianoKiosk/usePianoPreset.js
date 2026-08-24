import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoUser } from './PianoUserContext.jsx';
import { isPersistentUser } from './pianoUser.js';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';

const Ctx = createContext(null);
const MAX_FAVORITES = 8;
const logger = () => getLogger().child({ component: 'piano-preset' });

export function sanitizeSoundPreset(value) {
  if (!value || typeof value !== 'object' || value.voice?.pc == null) return null;
  return {
    voice: { ...value.voice, bank: value.voice.bank || 0 },
    reverb: value.reverb ? { ...value.reverb } : null,
    chorus: value.chorus ? { ...value.chorus } : null,
  };
}

export const soundVoiceKey = (value) => value?.voice?.pc == null ? null : `${value.voice.pc}:${value.voice.bank || 0}`;
const comparable = (value) => {
  const sound = sanitizeSoundPreset(value);
  if (!sound) return null;
  const effect = (item) => item ? { type: item.type ?? null, level: item.level ?? null, on: !!item.on } : null;
  return { voice: { pc: sound.voice.pc, bank: sound.voice.bank || 0 }, reverb: effect(sound.reverb), chorus: effect(sound.chorus) };
};
export const sameSoundPreset = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

export function PianoPresetProvider({ children }) { return createElement(Ctx.Provider, { value: usePianoPresetState() }, children); }
export function usePianoPreset() { const value = useContext(Ctx); if (!value) throw new Error('usePianoPreset must be used within PianoPresetProvider'); return value; }

function usePianoPresetState() {
  const { currentUser, currentProfile } = usePianoUser();
  const { applyBundle, currentBundle } = usePianoSoundBundle();
  const [preset, setPreset] = useState({});
  const [hydrationState, setHydrationState] = useState('loading');
  const [persistenceState, setPersistenceState] = useState('idle');
  const userRef = useRef(currentUser); userRef.current = currentUser;
  const presetRef = useRef(preset); presetRef.current = preset;
  const bundleRef = useRef(currentBundle); bundleRef.current = currentBundle;
  const applyRef = useRef(applyBundle); applyRef.current = applyBundle;
  const generationRef = useRef(0);
  const writeIdRef = useRef(0);
  const latestWriteRef = useRef(0);
  const writeQueueRef = useRef(Promise.resolve());
  const debounceRef = useRef(null);
  const suppressUntilRef = useRef(null);
  const lastPersistedRef = useRef(null);
  const retryRef = useRef(null);

  const enqueueWrite = useCallback((patch, { retryable = false } = {}) => {
    const user = userRef.current;
    if (!isPersistentUser(user)) return Promise.resolve({ ok: false, reason: 'guest' });
    const generation = generationRef.current;
    const writeId = ++writeIdRef.current;
    latestWriteRef.current = writeId;
    if (retryable) retryRef.current = patch;
    setPersistenceState('saving');
    const run = async () => {
      try {
        await DaylightAPI(`api/v1/piano/users/${user}/preset`, patch, 'PUT');
        if (generation === generationRef.current && user === userRef.current && writeId === latestWriteRef.current) setPersistenceState('remembered');
        if (patch.default && generation === generationRef.current && user === userRef.current) lastPersistedRef.current = patch.default;
        logger().info('piano.preset.write', { user, fields: Object.keys(patch), writeId });
        return { ok: true, writeId };
      } catch (error) {
        if (generation === generationRef.current && user === userRef.current && writeId === latestWriteRef.current) setPersistenceState('failed');
        logger().warn('piano.preset.write-failed', { user, fields: Object.keys(patch), writeId, error: error?.message });
        return { ok: false, reason: 'write-failed', error: error?.message, writeId };
      }
    };
    const task = writeQueueRef.current.catch(() => {}).then(run);
    writeQueueRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimeout(debounceRef.current);
    suppressUntilRef.current = null;
    lastPersistedRef.current = null;
    retryRef.current = null;
    setPreset({});
    setPersistenceState('idle');
    if (!isPersistentUser(currentUser)) { setHydrationState('guest'); return undefined; }
    setHydrationState('loading');
    let cancelled = false;
    DaylightAPI(`api/v1/piano/users/${currentUser}/preset`).then((raw) => {
      if (cancelled || generation !== generationRef.current) return;
      const loadedDefault = sanitizeSoundPreset(raw?.default);
      const favorites = Array.isArray(raw?.favorites) ? raw.favorites.map(sanitizeSoundPreset).filter(Boolean) : [];
      const sanitized = { ...(raw && typeof raw === 'object' ? raw : {}), ...(loadedDefault ? { default: loadedDefault } : {}), favorites };
      if (!loadedDefault) delete sanitized.default;
      setPreset(sanitized);
      setHydrationState('loaded');
      if (loadedDefault) {
        lastPersistedRef.current = loadedDefault;
        suppressUntilRef.current = loadedDefault;
        applyRef.current(loadedDefault);
      } else {
        // The hardware's initial sound is a baseline, not a player edit.
        lastPersistedRef.current = sanitizeSoundPreset(bundleRef.current);
      }
      logger().debug('piano.preset.loaded', { user: currentUser, hasDefault: !!loadedDefault, favorites: favorites.length });
    }).catch((error) => {
      if (cancelled || generation !== generationRef.current) return;
      setHydrationState('failed');
      setPersistenceState('failed');
      logger().warn('piano.preset.load-failed', { user: currentUser, error: error?.message });
    });
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, [currentUser]);

  useEffect(() => {
    if (hydrationState !== 'loaded' || !isPersistentUser(currentUser)) return undefined;
    const sound = sanitizeSoundPreset(currentBundle);
    if (!sound) return undefined;
    if (suppressUntilRef.current) {
      if (sameSoundPreset(sound, suppressUntilRef.current)) suppressUntilRef.current = null;
      return undefined;
    }
    if (sameSoundPreset(sound, lastPersistedRef.current)) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreset((previous) => ({ ...previous, default: sound }));
      enqueueWrite({ default: sound }, { retryable: true });
    }, 750);
    return () => clearTimeout(debounceRef.current);
  }, [currentBundle, currentUser, hydrationState, enqueueWrite]);

  const saveFavorite = useCallback(async (bundle = bundleRef.current) => {
    if (!isPersistentUser(userRef.current)) return { ok: false, reason: 'guest' };
    const sound = sanitizeSoundPreset(bundle);
    if (!sound) return { ok: false, reason: 'invalid-sound' };
    const existing = Array.isArray(presetRef.current.favorites) ? presetRef.current.favorites : [];
    const voiceKey = soundVoiceKey(sound);
    const found = existing.some((favorite) => soundVoiceKey(favorite) === voiceKey);
    if (!found && existing.length >= MAX_FAVORITES) return { ok: false, reason: 'limit' };
    const favorites = [...existing.filter((favorite) => soundVoiceKey(favorite) !== voiceKey), sound];
    const previous = existing;
    const generation = generationRef.current;
    const user = userRef.current;
    setPreset((value) => ({ ...value, favorites }));
    const result = await enqueueWrite({ favorites });
    if (!result.ok && generation === generationRef.current && user === userRef.current && JSON.stringify(presetRef.current.favorites) === JSON.stringify(favorites)) setPreset((value) => ({ ...value, favorites: previous }));
    return result;
  }, [enqueueWrite]);

  const removeFavorite = useCallback(async (bundle) => {
    if (!isPersistentUser(userRef.current)) return { ok: false, reason: 'guest' };
    const existing = Array.isArray(presetRef.current.favorites) ? presetRef.current.favorites : [];
    const favorites = existing.filter((favorite) => soundVoiceKey(favorite) !== soundVoiceKey(bundle));
    const generation = generationRef.current;
    const user = userRef.current;
    setPreset((value) => ({ ...value, favorites }));
    const result = await enqueueWrite({ favorites });
    if (!result.ok && generation === generationRef.current && user === userRef.current && JSON.stringify(presetRef.current.favorites) === JSON.stringify(favorites)) setPreset((value) => ({ ...value, favorites: existing }));
    return result;
  }, [enqueueWrite]);

  const saveDefault = useCallback(async (bundle = bundleRef.current) => {
    if (!isPersistentUser(userRef.current)) return { ok: false, reason: 'guest' };
    const sound = sanitizeSoundPreset(bundle);
    if (!sound) return { ok: false, reason: 'invalid-sound' };
    setPreset((value) => ({ ...value, default: sound }));
    return enqueueWrite({ default: sound }, { retryable: true });
  }, [enqueueWrite]);
  const retryLastSound = useCallback(() => retryRef.current ? enqueueWrite(retryRef.current, { retryable: true }) : Promise.resolve({ ok: false, reason: 'nothing-to-retry' }), [enqueueWrite]);

  return {
    preset,
    loaded: hydrationState === 'loaded' || hydrationState === 'guest',
    hydrationState,
    persistenceState,
    playerName: currentProfile?.name || currentUser,
    saveDefault,
    saveFavorite,
    addFavorite: saveFavorite,
    removeFavorite,
    retryLastSound,
    canSave: isPersistentUser(currentUser),
    maxFavorites: MAX_FAVORITES,
  };
}

export default usePianoPreset;
