/**
 * VoicePicker — GM voice chooser for a channel strip (design §7 Mix view).
 *
 * Surface choice: design §7 sends deep-scroll surfaces full-bleed but allows
 * "drawer when shallow". The always-available list is 8 voices — shallow — so
 * this is a BOTTOM DRAWER over the stage, not a full-screen takeover. With
 * the onboard tier the 16 GM family sections are collapsed by default, so the
 * surface stays shallow even at 128 voices (one family open at a time).
 *
 * Voice tiers:
 *  - The 8 tier-2-loadable programs (presetManifest GM_PROGRAMS — the presets
 *    the browser gmSynth self-hosts) are ALWAYS offered, with friendly names.
 *  - When the household's onboard GM tier is enabled (`onboardGm`), the piano
 *    itself renders voices and can address ALL 128 GM programs — the full
 *    catalog appears, grouped by the 16 standard GM families (collapsed
 *    sections, tap to expand).
 *
 * GM names/families come from the MDG-400 device profile's bank-0 table
 * (devices/suzukiMdg400.js) — that table IS the standard GM 128; reusing it
 * beats a duplicate 128-name list. (Its bank-1 "Asian Folk" extras are
 * device-only and excluded.)
 *
 * Groove layers never open this picker — the drum channel ignores program
 * changes; ChannelStrip renders their voice chip disabled ("Drums").
 */
import { useState } from 'react';
import { GM_PROGRAMS } from './presetManifest.js';
import { VOICE_GROUPS } from '../devices/suzukiMdg400.js';

/** Friendly labels for the tier-2 loadable programs (keyed by GM program #). */
export const FRIENDLY_VOICE_NAMES = Object.freeze({
  0: 'Grand Piano',
  4: 'E-Piano',
  24: 'Nylon Guitar',
  25: 'Steel Guitar',
  32: 'Acoustic Bass',
  33: 'Fingered Bass',
  48: 'Strings',
  88: 'Synth Pad',
});

/** The 16 standard GM families with their 8 programs each (bank 0 only). */
export const GM_FAMILY_SECTIONS = Object.freeze(
  VOICE_GROUPS
    .filter((g) => g.voices.every((v) => v.bank === 0))
    .map((g) => Object.freeze({
      family: g.group,
      voices: Object.freeze(g.voices.map(({ name, pc }) => Object.freeze({ program: pc, name }))),
    })),
);

const GM_NAME_BY_PROGRAM = new Map(
  GM_FAMILY_SECTIONS.flatMap((s) => s.voices.map((v) => [v.program, v.name])),
);

/**
 * Display name for a layer's voice: friendly tier-2 label, else the GM
 * catalog name, else a numbered fallback. `null` program = the drum channel.
 */
export function voiceName(program) {
  if (program == null) return 'Drums';
  return FRIENDLY_VOICE_NAMES[program]
    ?? GM_NAME_BY_PROGRAM.get(program)
    ?? `Voice ${program + 1}`;
}

/** The always-offered voices: tier-2 loadable programs with friendly names. */
export const BASE_VOICES = Object.freeze(
  GM_PROGRAMS.map((program) => Object.freeze({ program, name: voiceName(program) })),
);

function VoiceOption({ program, name, current, onPick }) {
  const isCurrent = program === current;
  return (
    <button
      type="button"
      role="option"
      aria-selected={isCurrent}
      className={`piano-voice-picker__voice${isCurrent ? ' is-current' : ''}`}
      onClick={() => onPick(program)}
    >
      {isCurrent && <span className="piano-voice-picker__check" aria-hidden="true">✓</span>}
      {name}
    </button>
  );
}

/**
 * @param {object} props
 * @param {number|null} props.current - the layer's current gmProgram
 * @param {(program:number) => void} props.onSelect - picked a voice (picker closes itself)
 * @param {() => void} props.onClose
 * @param {boolean} [props.onboardGm] - onboard tier live → offer all 128 GM programs
 */
export function VoicePicker({ current, onSelect, onClose, onboardGm = false }) {
  const [openFamily, setOpenFamily] = useState(null); // one family expanded at a time

  const pick = (program) => {
    onSelect?.(program);
    onClose?.();
  };

  return (
    <div className="piano-voice-picker" role="dialog" aria-label="voice picker">
      <button
        type="button"
        className="piano-voice-picker__scrim"
        aria-label="dismiss voice picker"
        onClick={onClose}
      />
      <div className="piano-voice-picker__drawer">
        <div className="piano-voice-picker__top">
          <span className="piano-voice-picker__title">Voice</span>
          <button
            type="button"
            className="piano-voice-picker__close"
            aria-label="close voice picker"
            onClick={onClose}
          >✕</button>
        </div>

        <div className="piano-voice-picker__base" role="listbox" aria-label="featured voices">
          {BASE_VOICES.map((v) => (
            <VoiceOption key={v.program} {...v} current={current} onPick={pick} />
          ))}
        </div>

        {onboardGm && (
          <div className="piano-voice-picker__all">
            <span className="piano-voice-picker__all-label">All 128 GM voices</span>
            {GM_FAMILY_SECTIONS.map(({ family, voices }) => {
              const expanded = openFamily === family;
              return (
                <section key={family} className="piano-voice-picker__family">
                  <button
                    type="button"
                    className={`piano-voice-picker__family-head${expanded ? ' is-open' : ''}`}
                    aria-expanded={expanded}
                    onClick={() => setOpenFamily(expanded ? null : family)}
                  >
                    <span>{family}</span>
                    <span className="piano-voice-picker__family-count" aria-hidden="true">
                      {expanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {expanded && (
                    <div className="piano-voice-picker__family-voices" role="listbox" aria-label={family}>
                      {voices.map((v) => (
                        <VoiceOption key={v.program} {...v} current={current} onPick={pick} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default VoicePicker;
