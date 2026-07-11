import { createContext, createElement, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoUser } from './PianoUserContext.jsx';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-preset' });
  return _logger;
}

// Identity for a favorite bundle, keyed by voice program+bank — two bundles
// with the same voice are "the same favorite" even if effects/volume differ.
function voiceKey(bundle) {
  const v = bundle?.voice;
  if (!v || v.pc == null) return null;
  return `${v.pc}:${v.bank || 0}`;
}

const PianoPresetContext = createContext(null);

/**
 * Per-user sound preset (opaque blob behind /users/:userId/preset): a default
 * bundle re-applied when that player is selected, plus a list of saved favorite
 * bundles. Provided ABOVE the whole shell (not inside the Sound Panel) so that
 * switching players applies the new player's default instrument/tone/volume and
 * swaps their favorites even when the panel is closed.
 *
 * GET on user change; auto-applies `preset.default` (if any) through
 * usePianoSoundBundle().applyBundle. Graceful degrade: no default means the
 * current sound is left alone — never resets the piano to silence just because a
 * player has no saved preset yet.
 */
export function PianoPresetProvider({ children }) {
  const value = usePianoPresetState();
  return createElement(PianoPresetContext.Provider, { value }, children);
}

/** Read the shared per-user preset surface. */
export function usePianoPreset() {
  const ctx = useContext(PianoPresetContext);
  if (!ctx) throw new Error('usePianoPreset must be used within a PianoPresetProvider');
  return ctx;
}

function usePianoPresetState() {
  const { currentUser } = usePianoUser();
  const { applyBundle } = usePianoSoundBundle();
  const [preset, setPreset] = useState({});
  const userRef = useRef(currentUser);
  userRef.current = currentUser;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const applyBundleRef = useRef(applyBundle);
  applyBundleRef.current = applyBundle;

  useEffect(() => {
    // Clear the previous player's preset IMMEDIATELY on switch — favorites/default
    // are per-user, so one player's saved sounds must never linger under another's
    // name while the new user's preset loads (or if they have none at all).
    setPreset({});
    if (!currentUser) return undefined;
    let cancelled = false;
    DaylightAPI(`api/v1/piano/users/${currentUser}/preset`)
      .then((r) => {
        if (cancelled) return;
        const loaded = r && typeof r === 'object' ? r : {};
        setPreset(loaded);
        // Graceful degrade: only re-assert sound when a default was actually saved.
        if (loaded.default) {
          applyBundleRef.current(loaded.default);
        }
        logger().debug('preset.load', { user: currentUser, hasDefault: !!loaded.default });
      })
      .catch((e) => {
        if (!cancelled) setPreset({});
        logger().warn('preset.load.fail', { user: currentUser, error: e?.message });
      });
    return () => { cancelled = true; };
  }, [currentUser]);

  const saveDefault = useCallback(async (bundle) => {
    const user = userRef.current;
    if (!user) return;
    setPreset((prev) => ({ ...prev, default: bundle })); // optimistic
    try {
      await DaylightAPI(`api/v1/piano/users/${user}/preset`, { default: bundle }, 'PUT');
      logger().info('preset.saveDefault', { user });
    } catch (e) {
      logger().error('preset.saveDefault.fail', { user, error: e?.message });
    }
  }, []);

  const addFavorite = useCallback(async (bundle) => {
    const user = userRef.current;
    if (!user) return;
    const key = voiceKey(bundle);
    const existing = Array.isArray(presetRef.current.favorites) ? presetRef.current.favorites : [];
    const deduped = key ? existing.filter((f) => voiceKey(f) !== key) : existing;
    const favorites = [...deduped, bundle];
    setPreset((prev) => ({ ...prev, favorites })); // optimistic
    try {
      await DaylightAPI(`api/v1/piano/users/${user}/preset`, { favorites }, 'PUT');
      logger().info('preset.addFavorite', { user });
    } catch (e) {
      logger().error('preset.addFavorite.fail', { user, error: e?.message });
    }
  }, []);

  return { preset, saveDefault, addFavorite };
}

export default usePianoPreset;
