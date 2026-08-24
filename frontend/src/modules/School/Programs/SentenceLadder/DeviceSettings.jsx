import Popover from './Popover.jsx';

/**
 * What this device can do — which decides which rungs exist (design §1).
 *
 * Previously three unlabelled chips (`EN`, `KR`, `mic`) pinned to the bottom
 * of the drill screen. Three things were wrong with that and all three
 * mattered on the real panel:
 *
 *  1. **Bottom edge is the Portal's swipe-up gesture zone.** A missed tap on a
 *     34px target there summons the system Control Center, which cannot be
 *     disabled — only auto-dismissed. Device config does not belong in the one
 *     region where a near-miss leaves the app.
 *  2. **It read as navigation.** The chips shared their treatment with the rung
 *     tabs, so "KR" looked like "Dictation" — one changed the view, the other
 *     silently reshaped tomorrow's queue.
 *  3. **The label lied.** "This device can type:" fronted a microphone toggle.
 *
 * It is configuration set once per device, so it lives behind a deliberate
 * affordance with words rather than codes, at full touch size.
 */
export default function DeviceSettings({ languages, capabilities, onToggleLanguage, onToggleMic }) {
  if (!languages) return null;

  const rows = [
    {
      key: `text:${languages.source}`,
      label: `${languages.source} keyboard`,
      hint: 'Needed to type meanings',
      on: capabilities.textInput.includes(languages.source),
      toggle: () => onToggleLanguage(languages.source),
    },
    {
      key: `text:${languages.target}`,
      label: `${languages.target} keyboard`,
      hint: 'Needed for dictation',
      on: capabilities.textInput.includes(languages.target),
      toggle: () => onToggleLanguage(languages.target),
    },
    {
      key: 'mic',
      label: 'Microphone',
      hint: 'Needed to record yourself',
      on: capabilities.microphone,
      toggle: onToggleMic,
    },
  ];

  return (
    <Popover label="Device" ariaLabel="What this device can do">
      <div className="lang-settings" role="none">
        <p className="lang-settings__title">What this device can do</p>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={row.on}
            className={`lang-settings__row${row.on ? ' is-on' : ''}`}
            onClick={row.toggle}
          >
            <span className="lang-settings__state" aria-hidden="true">{row.on ? '✓' : ''}</span>
            <span className="lang-settings__text">
              <span className="lang-settings__label">{row.label}</span>
              <span className="lang-settings__hint">{row.hint}</span>
            </span>
          </button>
        ))}
        {/* Turning one off removes its rung from the ladder; sentences graduate
            across the gap rather than stalling. Saying so here is what makes
            the mic-denied escape hatch discoverable instead of a dead end. */}
        <p className="lang-settings__note">
          Turning one off skips that step. Nothing is lost.
        </p>
      </div>
    </Popover>
  );
}
