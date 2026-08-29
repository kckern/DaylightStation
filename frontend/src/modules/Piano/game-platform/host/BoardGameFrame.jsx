import PianoGameHost from './PianoGameHost.jsx';
import InstrumentBoardStage from '../families/addressed-board/InstrumentBoardStage.jsx';
import { BOARD_LAYOUTS } from '../families/addressed-board/contracts.js';
import GameButton from '../chrome/GameButton.jsx';
import GameStatusBar from '../chrome/GameStatusBar.jsx';
import GearIcon from '../chrome/GearIcon.jsx';

function injectSettings(rail, settings) {
  if (!rail && !settings) return null;
  if (!settings) return rail?.content ?? rail;
  const trigger = (
    <GameButton variant="icon" onClick={settings.onOpen} aria-expanded={settings.open} aria-label="Settings" title="Settings">
      <GearIcon />
    </GameButton>
  );
  const slot = rail || {};
  return slot.render ? slot.render({ settingsTrigger: trigger }) : slot.content ?? rail;
}

/** Shared furniture; game rules and every slot's content remain game-owned. */
export default function BoardGameFrame({
  gameId, className = '', style, phase = 'playing', instrument, instrumentClassName = '',
  layout = BOARD_LAYOUTS.SINGLE, primary, secondary = null, topRail = null,
  leftRail = null, rightRail = null, status = null, settings = null,
  opening = null, result = null, children = null,
}) {
  // A game may already compose InstrumentBoardStage itself while migrating its
  // dense semantic slots. The frame still owns the host and keyboard dock.
  if (primary === undefined) {
    return (
      <PianoGameHost gameId={gameId} className={className} style={style} phase={phase} instrument={instrument} instrumentClassName={instrumentClassName}>
        {children}
      </PianoGameHost>
    );
  }
  const selectedRail = settings?.rail === 'left' ? 'left' : 'right';
  const left = injectSettings(leftRail, selectedRail === 'left' ? settings : null);
  const right = injectSettings(rightRail, selectedRail === 'right' ? settings : null);
  const statusNode = status && (status.type ? status : (
    <GameStatusBar aside={status.aside} action={status.action}>{status.message}</GameStatusBar>
  ));
  return (
    <PianoGameHost gameId={gameId} className={className} style={style} phase={phase} instrument={instrument} instrumentClassName={instrumentClassName} overlay={opening || result || null}>
      <InstrumentBoardStage layout={layout} primary={primary} secondary={secondary} topRail={topRail} leftRail={left} rightRail={right} status={statusNode} />
      {settings?.open && settings.content}
      {children}
    </PianoGameHost>
  );
}
