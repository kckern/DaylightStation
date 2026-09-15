import { useEffect, useRef } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import PianoGameHost from './PianoGameHost.jsx';
import InstrumentBoardStage from '../families/addressed-board/InstrumentBoardStage.jsx';
import { BOARD_LAYOUTS } from '../families/addressed-board/contracts.js';
import GameButton from '../chrome/GameButton.jsx';
import GameStatusBar from '../chrome/GameStatusBar.jsx';
import GearIcon from '../chrome/GearIcon.jsx';
import PianoFullscreenToggle from '../../PianoKiosk/PianoFullscreenToggle.jsx';
import {
  useBoardGameFullscreen,
  useHostedFullscreenToggle,
  usePianoFullscreen,
} from '../../PianoKiosk/PianoFullscreenContext.jsx';
import { usePianoKioskConfigOptional } from '../../PianoKiosk/PianoConfig.jsx';
import { PIANO_CONFIG_DEFAULTS } from '../../PianoKiosk/pianoConfigModel.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'board-game-frame' });
  return _logger;
}

function injectSettings(rail, settings, fullscreenToggle = null) {
  if (!rail && !settings) return null;
  if (!settings) return rail?.render ? rail.render({ settingsTrigger: null }) : rail?.content ?? rail;
  const title = settings.title || 'Settings';
  // The full-screen toggle rides in the same cluster as the gear: the rail foot
  // is where a player's hand already goes for "change how this looks", and in
  // full screen there is no header left to carry it.
  const trigger = (
    <span className="pg-rail__foot-actions">
      {fullscreenToggle}
      <GameButton variant="icon" onClick={settings.onOpen} aria-expanded={settings.open} aria-label={title} title={title}>
        <GearIcon />
      </GameButton>
    </span>
  );
  const slot = rail || {};
  return slot.render ? slot.render({ settingsTrigger: trigger }) : slot.content ?? rail;
}

/** The keyboard range a game shows in full screen, or null to keep its own. */
function fullscreenRange(settings, gameId) {
  const range = settings?.keyboardRange?.[gameId];
  return Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) && range[0] < range[1]
    ? range
    : null;
}

/**
 * What full screen actually gave the board, in layout pixels (offset sizes, so
 * the kiosk's design-scale transform does not distort them). This is the line
 * that answers "the header is still there" or "the keyboard did not shrink"
 * from the log store instead of from a photo of the tablet.
 */
function measureLayout(host) {
  const size = (el) => (el ? { w: el.offsetWidth, h: el.offsetHeight } : null);
  const instrument = size(host.querySelector('.piano-game-host__instrument'));
  const slot = size(host.querySelector('.instrument-board-stage__primary'));
  return {
    hostW: host.offsetWidth,
    hostH: host.offsetHeight,
    keyboardH: instrument?.h ?? 0,
    boardSlotW: slot?.w ?? null,
    boardSlotH: slot?.h ?? null,
    headerVisible: Boolean(host.ownerDocument?.querySelector('.piano-chrome')),
  };
}

/**
 * Shared furniture; game rules and every slot's content remain game-owned.
 *
 * A board game owns BOARD-GAME FULL SCREEN while it is mounted: it arrives in it
 * (unless the household config says otherwise), the toggle beside the settings
 * gear steps out of it, and in it the keyboard is shortened by the configured
 * scale and may show a wider range. See PianoFullscreenContext.jsx.
 */
export default function BoardGameFrame({
  gameId, className = '', style, phase = 'playing', instrument, instrumentClassName = '',
  layout = BOARD_LAYOUTS.SINGLE, primary, secondary = null, topRail = null,
  leftRail = null, rightRail = null, status = null, settings = null,
  opening = null, result = null, children = null, stageClassName = '',
}) {
  const kioskConfig = usePianoKioskConfigOptional();
  const fullscreenSettings = kioskConfig?.config?.boardGameFullscreen ?? PIANO_CONFIG_DEFAULTS.boardGameFullscreen;
  useBoardGameFullscreen(gameId, { enter: fullscreenSettings.enterOnOpen !== false });
  const { fullscreen, mode } = usePianoFullscreen();

  const selectedRail = settings?.rail === 'left' ? 'left' : 'right';
  // Hosted only where the trigger is actually drawn: a settings rail given as a
  // render function. Anything else leaves the toggle to the kiosk's own copy.
  const settingsRail = selectedRail === 'left' ? leftRail : rightRail;
  const hostsToggle = useHostedFullscreenToggle(Boolean(settings && settingsRail?.render));
  const toggle = hostsToggle
    ? <PianoFullscreenToggle className="pg-btn pg-btn--icon" source={`game:${gameId}`} />
    : null;
  const left = injectSettings(leftRail, selectedRail === 'left' ? settings : null, toggle);
  const right = injectSettings(rightRail, selectedRail === 'right' ? settings : null, toggle);
  const statusNode = status && (status.type ? status : (
    <GameStatusBar aside={status.aside} action={status.action}>{status.message}</GameStatusBar>
  ));

  const range = fullscreen ? fullscreenRange(fullscreenSettings, gameId) : null;
  const shownInstrument = instrument && range
    ? { ...instrument, startNote: range[0], endNote: range[1] }
    : instrument;
  const scale = Number(fullscreenSettings.keyboardHeightScale);
  const hostStyle = Number.isFinite(scale) && scale > 0
    ? { ...style, '--pg-fullscreen-keyboard-scale': scale }
    : style;

  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof requestAnimationFrame === 'undefined') return undefined;
    // Two frames: the class change lands, then the layout it causes.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        logger().info('piano-game.fullscreen.layout', {
          gameId,
          fullscreen,
          mode,
          keyboardRange: range ?? [shownInstrument?.startNote ?? null, shownInstrument?.endNote ?? null],
          ...measureLayout(host),
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // Measured when the full-screen answer changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, fullscreen, mode]);

  return (
    <PianoGameHost hostRef={hostRef} gameId={gameId} className={className} style={hostStyle} phase={phase} instrument={shownInstrument} instrumentClassName={instrumentClassName} overlay={opening || result || null} compactInstrument>
      <InstrumentBoardStage className={stageClassName} layout={layout} primary={primary} secondary={secondary} topRail={topRail} leftRail={left} rightRail={right} status={statusNode} />
      {settings?.open && settings.content}
      {children}
    </PianoGameHost>
  );
}
