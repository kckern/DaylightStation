import { useCallback, useEffect, useMemo, useState } from 'react';
import { languageLog } from './languageLog.js';
import { canCompose } from '../../ime/languages.js';
import { useHardwareKeyboard } from '../../../../hooks/useHardwareKeyboard.js';

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
 *
 * **AND THE KEYBOARD QUESTION WAS BEING ANSWERED WRONG.** "Is there a keyboard"
 * was read off `matchMedia('(pointer: fine)')`, which asks whether there is a
 * MOUSE. On a desktop the two come together; on the Portal — a touch panel with
 * a Korean/English Bluetooth keyboard bonded to it since 2026-09-09 — they do
 * not, so the panel the in-page Hangul IME was written for was the one panel
 * that could never reach it. Dictation and Interpretation were withheld on
 * every session it ran (verified in the log store: `textInput: []`,
 * `microphone: true`, every run, while `pkctl input` listed the keyboard as
 * connected), and the child was told to continue on another device.
 *
 * `lib/hardwareKeyboard.js` now answers it, from a mouse OR the fleet registry
 * OR an actual keypress. The floor survives because none of those three ever
 * says "no keyboard" — they only ever find one.
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
 * @param {string} corpusId
 * @param {{source: string, target: string}} [languages]
 */
export function useCapabilities(corpusId, languages) {
  const [microphone, setMicrophone] = useState(false);
  const [textInput, setTextInput] = useState([]);
  const [ready, setReady] = useState(false);
  // Not a constant: the registry answers over the network and a keypress can
  // come at any moment, so this flips from false to true mid-session and the
  // effect below has to run again when it does.
  const keyboard = useHardwareKeyboard();

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
      if (keyboard) {
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
  }, [corpusId, languages?.source, languages?.target, keyboard]);

  const update = useCallback((next) => {
    const value = {
      microphone: next.microphone ?? microphone,
      textInput: next.textInput ?? textInput,
    };
    setMicrophone(value.microphone);
    setTextInput(value.textInput);
    saveOverrides(corpusId, value);
    // WHAT CHANGED, not only what the device now claims. An override is the
    // single most consequential thing a grown-up can do here — it decides which
    // rungs the ladder has tomorrow, and it persists in this browser's storage
    // until someone changes it back — so the record has to be readable on its
    // own, without hunting down the previous event to diff against. The two
    // affordances that reach here (the Device sheet's rows, and the Recording
    // rung disabling the mic after a denial) are both covered by instrumenting
    // this one place; neither has to carry telemetry of its own.
    languageLog.capability('overridden', {
      corpus: corpusId,
      ...value,
      from: { microphone, textInput },
      changed: [
        ...(value.microphone !== microphone ? ['microphone'] : []),
        ...(value.textInput.join() !== textInput.join() ? ['textInput'] : []),
      ],
    });
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
  const hasHardwareKeyboard = keyboard;

  return { capabilities, ready, update, toggleLanguage, toggleMicrophone, hasHardwareKeyboard };
}

export default useCapabilities;
