import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './usePianoSound.js';
import { usePianoBreadcrumbBar } from './PianoBreadcrumbContext.jsx';
import { useLongPress } from './useLongPress.js';
import SoundPanel from './SoundPanel.jsx';
import OperatorDrawer from './OperatorDrawer.jsx';
import PianoLinkBanner from './PianoLinkBanner.jsx';
import PianoUserChip from './PianoUserChip.jsx';
import Icon from '../ui/icons/Icon.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { usePianoFullscreen } from './PianoFullscreenContext.jsx';
import PianoFullscreenToggle from './PianoFullscreenToggle.jsx';

/**
 * PianoChrome — the kiosk header. Left: a breadcrumb trail `home › mode › …deeper
 * crumbs` (home returns to the menu, the mode crumb to the mode index, deeper
 * routes publish their own segments; the deepest is the current page). Right: a
 * single status chip showing the connection dot + active voice — **tap** opens
 * Sound and a 550ms hold opens adult-only Piano Maintenance — then the full-screen
 * toggle.
 *
 * In full screen the header is not drawn and the toggle floats in the corner, so
 * the way back is always one tap. The connection banner stays in either mode: a
 * lost piano is the one thing full screen must never hide. When the surface on
 * screen hosts the toggle itself (a board game's rail foot), neither copy here
 * is drawn.
 *
 * @param {string} [modeLabel] - current mode name (empty on home)
 * @param {string} [modeKey] - current mode route segment, for the mode crumb link
 */
export function PianoChrome({ modeLabel, modeKey }) {
  const navigate = useNavigate();
  const { health } = usePianoConnection();
  const { basePath } = usePianoKioskConfig();
  const { activeName } = usePianoSound();
  const { crumbs: extraCrumbs } = usePianoBreadcrumbBar();
  const [soundOpen, setSoundOpen] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const chipPress = useLongPress(() => setOperatorOpen(true), { onTap: () => setSoundOpen(true) });
  const { fullscreen, hosted } = usePianoFullscreen();

  // Assemble the trail: mode crumb (links to the mode index) + any deeper crumbs
  // published by the active route. The last crumb renders as the current page —
  // it can still carry an onClick (e.g. a mode crumb that reopens a picker).
  const trail = [];
  if (modeLabel) trail.push({ label: modeLabel, onClick: () => navigate(`${basePath}/${modeKey}`) });
  (extraCrumbs || []).forEach((c) => trail.push({ label: c.label, onClick: c.onClick, icon: c.icon, image: c.image }));

  const crumbBody = (c) => (
    <Fragment>
      {c.image && <img className="piano-chrome__crumb-thumb" src={c.image} alt="" />}
      {c.icon && <Icon name={c.icon} />}
      {c.label}
    </Fragment>
  );

  return (
    <Fragment>
    {fullscreen ? (
      !hosted && <PianoFullscreenToggle className="piano-chrome__gear piano-fullscreen-toggle--floating" source="floating" />
    ) : (
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
          const cls = `piano-chrome__crumb${isLast ? ' piano-chrome__crumb--current' : ''}`;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <span className="piano-chrome__sep" aria-hidden>›</span>
              {c.onClick ? (
                <button type="button" className={cls} onClick={c.onClick}>
                  {crumbBody(c)}
                </button>
              ) : (
                <span className={cls}>{crumbBody(c)}</span>
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="piano-chrome__right">
        <PianoUserChip />
        <button
          type="button"
          className={`piano-chrome__chip piano-chrome__chip--${health.state === 'ready' ? 'on' : 'off'}`}
          aria-label={`Change sound, ${activeName}. Piano ${health.copy}`}
          {...chipPress}
        >
          <span className="piano-chrome__dot" />
          <span className="piano-chrome__chiplabel">{activeName}</span>
          <span className="piano-chrome__chevron" aria-hidden>›</span>
        </button>
        {!hosted && <PianoFullscreenToggle className="piano-chrome__gear" source="header" />}
      </div>

      <SoundPanel open={soundOpen} onClose={() => setSoundOpen(false)} />
      <OperatorDrawer open={operatorOpen} onClose={() => setOperatorOpen(false)} />
    </header>
    )}
    {/* Below the header bar so a dropped OUT link (and its recovery) is impossible
        to miss while the player is changing instrument/tone/volume. */}
    <PianoLinkBanner />
    </Fragment>
  );
}

export default PianoChrome;
