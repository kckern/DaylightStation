import { useCallback, useEffect, useMemo, useState } from 'react';
import { languageLog } from './languageLog.js';

/**
 * What THIS device can do, which decides which rungs exist (design §1).
 *
 * Microphone presence is genuinely detectable. **Script availability is not.**
 * There is no web API that answers "can this device type Hangul" — an on-screen
 * keyboard may or may not have the IME installed, and probing would either lie
 * or trigger a permission prompt. So rather than fake a detection, text input
 * is a declared, per-device setting with a conservative default.
 *
 * Conservative means: assume nothing. A device that cannot be shown to have a
 * keyboard gets `textInput: []`, which leaves only `repetition` — the rung that
 * runs anywhere. Under-claiming costs the learner some rungs until someone
 * flips a switch; over-claiming strands them on an input they cannot use, which
 * is the failure this whole capability system exists to prevent.
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
      const detected = {
        microphone: mic,
        // Only the SOURCE language is assumed, and only where a keyboard is
        // likely. The target script is never assumed — a US keyboard cannot
        // type Hangul, and offering dictation on one is exactly the dead end
        // the ladder filtering exists to avoid.
        textInput: guessHasKeyboard() && languages?.source ? [languages.source] : [],
      };

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
  }, [corpusId, languages?.source]);

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
