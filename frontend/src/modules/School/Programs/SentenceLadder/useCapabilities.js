import { useCallback, useEffect, useMemo, useState } from 'react';
import { languageLog } from './languageLog.js';
import { canCompose } from '../../ime/languages.js';

/**
 * What THIS device can do, which decides which rungs exist (design §1).
 *
 * Microphone presence is detectable. Script availability used to not be: there
 * is no web API that answers "can this device type Hangul", an on-screen
 * keyboard may or may not have the IME installed, and probing would either lie
 * or trigger a permission prompt. So text input stayed a declared, per-device
 * setting with a deliberately empty default.
 *
 * **THAT QUESTION HAS CHANGED.** School now composes the target script itself
 * (`modules/School/ime/`), because the Portal's WebView has no IME for its
 * physical keyboard at all. Whether the OS can type Hangul is no longer the
 * question — whether there is a keyboard to type on is. So a device with one
 * claims every language the in-page IME can compose, and the old "a US keyboard
 * cannot type Hangul" caution now applies only to scripts we have no composer
 * for.
 *
 * The conservative floor is unchanged: a device with no keyboard still gets
 * `textInput: []`, leaving only `repetition` — the rung that runs anywhere.
 * Over-claiming strands a learner on an input they cannot use, which is the
 * failure this whole capability system exists to prevent.
 */

const STORAGE_KEY = 'school.language.capabilities';

function loadOverrides(corpusId) {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return all[corpusId] || null;
  } catch {
    return null;
  }
}

function saveOverrides(corpusId, value) {
  try {
    const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    all[corpusId] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A device with storage disabled simply re-declares each session. Not
    // worth surfacing — the defaults still produce a working program.
  }
}

async function detectMicrophone() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Existence, not permission. Asking for permission here would prompt on
    // mount, before the learner has chosen to do anything that needs a mic.
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return false;
  }
}

/**
 * A fine pointer implies a mouse, which in practice implies a real keyboard.
 * Touch-only means the Portal panel, where we assume nothing.
 */
function guessHasKeyboard() {
  try {
    return window.matchMedia?.('(pointer: fine)')?.matches === true;
  } catch {
    return false;
  }
}

/**
 * @param {string} corpusId
 * @param {{source: string, target: string}} [languages]
 */
export function useCapabilities(corpusId, languages) {
  const [microphone, setMicrophone] = useState(false);
  const [textInput, setTextInput] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!corpusId) return undefined;
    let alive = true;

    (async () => {
      const mic = await detectMicrophone();
      if (!alive) return;

      const stored = loadOverrides(corpusId);
      // A keyboard types the source language directly, and any target script
      // the in-page IME can compose. A target we have no composer for is still
      // withheld: offering dictation there is exactly the dead end the ladder
      // filtering exists to avoid.
      const typable = [];
      if (guessHasKeyboard()) {
        if (languages?.source) typable.push(languages.source);
        if (languages?.target && canCompose(languages.target)) typable.push(languages.target);
      }
      const detected = { microphone: mic, textInput: typable };

      const resolved = stored ?? detected;
      setMicrophone(resolved.microphone);
      setTextInput(resolved.textInput || []);
      setReady(true);

      languageLog.capability(stored ? 'restored' : 'detected', {
        corpus: corpusId,
        microphone: resolved.microphone,
        textInput: resolved.textInput,
      });
    })();

    return () => { alive = false; };
  }, [corpusId, languages?.source, languages?.target]);

  const update = useCallback((next) => {
    const value = {
      microphone: next.microphone ?? microphone,
      textInput: next.textInput ?? textInput,
    };
    setMicrophone(value.microphone);
    setTextInput(value.textInput);
    saveOverrides(corpusId, value);
    languageLog.capability('overridden', { corpus: corpusId, ...value });
  }, [corpusId, microphone, textInput]);

  const toggleLanguage = useCallback((code) => {
    const has = textInput.includes(code);
    update({ textInput: has ? textInput.filter((c) => c !== code) : [...textInput, code] });
  }, [textInput, update]);

  const capabilities = useMemo(() => ({ microphone, textInput }), [microphone, textInput]);

  const toggleMicrophone = useCallback(() => {
    update({ microphone: !microphone });
  }, [microphone, update]);

  // Whether keyboard SHORTCUTS are worth mentioning — distinct from whether a
  // script can be typed. A touch panel may well have a Hangul IME on its
  // on-screen keyboard while having no Tab or Enter key at all, so telling
  // that learner "Tab replays · Enter submits" is instructions for hardware
  // they do not have.
  const hasHardwareKeyboard = useMemo(() => guessHasKeyboard(), []);

  return { capabilities, ready, update, toggleLanguage, toggleMicrophone, hasHardwareKeyboard };
}

export default useCapabilities;
