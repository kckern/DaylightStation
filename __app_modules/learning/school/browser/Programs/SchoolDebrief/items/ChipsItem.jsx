import { useEffect, useState } from 'react';
import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";
import { useSchoolDebriefKeys, speak } from "../useSchoolDebriefKeys.js";
import { schoolDebriefLog } from "../schoolDebriefLog.js";

// Keys 1-9 pick the first nine chips, 0 the tenth; the rest are tap-only.
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Split a saved "Reading, Math, Other thing" back into chips plus the leftover text. */
function parseInitial(initial, options) {
  const parts = String(initial ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const selected = parts.filter((p) => options.includes(p));
  const other = parts.filter((p) => !options.includes(p)).join(', ');
  return { selected, other };
}

/**
 * Pick the classes they had today: tap a chip or press its digit, optionally
 * type an Other, Enter submits. Optional, so an empty pick may be submitted.
 * Digits are ignored while the Other field has focus (the key hook skips
 * typing targets); the field never autofocuses.
 */
export default function ChipsItem({ prompt, options = [], initial = '', onSubmit, onBack = null, busy = false }) {
  const [selected, setSelected] = useState(() => parseInitial(initial, options).selected);
  const [other, setOther] = useState(() => parseInitial(initial, options).other);
  useEffect(() => {
    const p = parseInitial(initial, options);
    setSelected(p.selected); setOther(p.other);
  }, [prompt.id, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (opt) => setSelected((s) => (s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt]));
  const submit = () => {
    if (busy) return;
    const extra = other.trim();
    const text = [...selected, ...(extra ? [extra] : [])].join(', ');
    schoolDebriefLog.chips({ count: selected.length, other: Boolean(extra) });
    onSubmit({ text, via: 'chips', audioRef: null });
  };

  useSchoolDebriefKeys({
    ...Object.fromEntries(options.slice(0, 10).map((opt, i) => [DIGITS[i], () => toggle(opt)])),
    enter: submit,
    tab: () => speak(prompt.text),
    ...(onBack ? { arrowleft: onBack } : {}),
  });

  return (
    <section className="sd-item sd-prompt sd-chips" aria-label="Classes">
      <h2 className="sd-prompt__text">{prompt.text}</h2>
      <div className="sd-chips__grid">
        {options.map((opt, i) => (
          <TouchButton key={opt} variant={selected.includes(opt) ? 'primary' : 'secondary'} keyHint={i < 10 ? DIGITS[i] : undefined}
            aria-pressed={selected.includes(opt)} onClick={() => toggle(opt)}>{opt}</TouchButton>
        ))}
      </div>
      <input
        className="sd-chips__other sd-prompt__field" type="text" value={other} placeholder="Something else?" aria-label="Other class"
        onChange={(e) => setOther(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      <div className="sd-controls">
        {onBack && <TouchButton variant="secondary" keyHint="←" onClick={onBack}><Icon name="back" /> Back</TouchButton>}
        <TouchButton variant="primary" keyHint="Enter" onClick={submit} disabled={busy}><Icon name="next" /> Next</TouchButton>
      </div>
    </section>
  );
}
