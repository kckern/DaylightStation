import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './PianoSoundContext.jsx';
import { usePianoBreadcrumbBar } from './PianoBreadcrumbContext.jsx';
import { useLongPress } from './useLongPress.js';
import SoundPanel from './SoundPanel.jsx';
import OperatorDrawer from './OperatorDrawer.jsx';
import PianoUserChip from './PianoUserChip.jsx';
import Icon from './icons/Icon.jsx';

/**
 * PianoChrome — always-on header. Left: a breadcrumb trail `home › mode › …deeper
 * crumbs` (home returns to the menu, the mode crumb to the mode index, deeper
 * routes publish their own segments; the deepest is the current page). Right: a
 * single status chip showing the connection dot + the active voice name (design
 * §8, audit D1) — **tap** opens the player-facing Sound Panel, **long-press**
 * opens the Operator Drawer (maintenance console). When disconnected, an inline
 * Reconnect affordance surfaces right on the chip (resolves audit T2 — "my piano
 * is silent" no longer buried under a settings tab).
 *
 * @param {string} [modeLabel] - current mode name (empty on home)
 * @param {string} [modeKey] - current mode route segment, for the mode crumb link
 */
export function PianoChrome({ modeLabel, modeKey }) {
  const navigate = useNavigate();
  const { connected, connect } = usePianoMidi();
  const { basePath } = usePianoKioskConfig();
  const { activeName } = usePianoSound();
  const { crumbs: extraCrumbs } = usePianoBreadcrumbBar();
  const [soundOpen, setSoundOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const chipPress = useLongPress(() => setOperatorOpen(true), { onTap: () => setSoundOpen(true) });

  // Assemble the trail: mode crumb (links to the mode index) + any deeper crumbs
  // published by the active route. The last crumb renders as the current page.
  const trail = [];
  if (modeLabel) trail.push({ label: modeLabel, onClick: () => navigate(`${basePath}/${modeKey}`) });
  (extraCrumbs || []).forEach((c) => trail.push({ label: c.label, onClick: c.onClick }));

  return (
    <header className="piano-chrome">
      <nav className="piano-chrome__crumbs" aria-label="Breadcrumb">
        <button
          type="button"
          className="piano-chrome__home"
          onClick={() => navigate(basePath)}
          aria-label="Home"
        >
          <Icon name="piano" />
        </button>

        {trail.map((c, i) => {
          const isLast = i === trail.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <span className="piano-chrome__sep" aria-hidden>›</span>
              {!isLast && c.onClick ? (
                <button type="button" className="piano-chrome__crumb" onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <span className={`piano-chrome__crumb${isLast ? ' piano-chrome__crumb--current' : ''}`}>
                  {c.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="piano-chrome__right">
        <PianoUserChip />
        <button
          type="button"
          className={`piano-chrome__chip piano-chrome__chip--${connected ? 'on' : 'off'}`}
          aria-label="Sound (tap) — Operator (hold)"
          title="Tap for Sound, hold for Operator"
          {...chipPress}
        >
          <span className="piano-chrome__dot" />
          <span className="piano-chrome__chiplabel">{activeName}</span>
        </button>
        {!connected && (
          <button
            type="button"
            className="piano-chrome__reconnect"
            onClick={connect}
          >
            Reconnect
          </button>
        )}
      </div>

      <SoundPanel open={soundOpen} onClose={() => setSoundOpen(false)} />
      <OperatorDrawer open={operatorOpen} onClose={() => setOperatorOpen(false)} />
    </header>
  );
}

export default PianoChrome;
