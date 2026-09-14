import PianoGameHost from './PianoGameHost.jsx';
import InstrumentBoardStage from '../families/addressed-board/InstrumentBoardStage.jsx';
import { BOARD_LAYOUTS } from '../families/addressed-board/contracts.js';
import GameButton from '../chrome/GameButton.jsx';
import GameStatusBar from '../chrome/GameStatusBar.jsx';
import GearIcon from '../chrome/GearIcon.jsx';
import PianoFullscreenToggle from '../../PianoKiosk/PianoFullscreenToggle.jsx';
import { useHostedFullscreenToggle } from '../../PianoKiosk/PianoFullscreenContext.jsx';

function injectSettings(rail, settings, fullscreenToggle = null) {
  if (!rail && !settings) return null;
  if (!settings) return rail?.render ? rail.render({ settingsTrigger: null }) : rail?.content ?? rail;
  const title = settings.title || 'Settings';
  // The kiosk's full-screen toggle rides in the same cluster as the gear: the
  // rail foot is where a player's hand already goes for "change how this looks",
  // and in full screen there is no header left to carry it.
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

/** Shared furniture; game rules and every slot's content remain game-owned. */
export default function BoardGameFrame({
  gameId, className = '', style, phase = 'playing', instrument, instrumentClassName = '',
  layout = BOARD_LAYOUTS.SINGLE, primary, secondary = null, topRail = null,
  leftRail = null, rightRail = null, status = null, settings = null,
  opening = null, result = null, children = null, stageClassName = '',
}) {
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
  return (
    <PianoGameHost gameId={gameId} className={className} style={style} phase={phase} instrument={instrument} instrumentClassName={instrumentClassName} overlay={opening || result || null} compactInstrument>
      <InstrumentBoardStage className={stageClassName} layout={layout} primary={primary} secondary={secondary} topRail={topRail} leftRail={left} rightRail={right} status={statusNode} />
      {settings?.open && settings.content}
      {children}
    </PianoGameHost>
  );
}
