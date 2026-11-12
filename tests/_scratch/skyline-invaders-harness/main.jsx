// Renders the real InvadersScene and InvadersHud from a fixture game state.
//   /?scene=battle      (see SCENES in scenes.js)
// No engine loop runs: each scene is one frozen frame.
import React from 'react';
import { createRoot } from 'react-dom/client';
import InvadersScene from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/InvadersScene.jsx';
import InvadersHud from '../../../__app_modules/wellness/fitness/browser/widgets/SkylineInvaders/InvadersHud.jsx';
import { MomentBanner } from '../../../__capabilities/gaming/browser/platform/ui/hud/index.js';
import { SCENES } from './scenes.js';

const name = new URLSearchParams(location.search).get('scene') || 'battle';
const fixture = SCENES[name];
const root = createRoot(document.getElementById('root'));
if (!fixture) {
  document.body.dataset.harnessError = `unknown scene ${name}`;
  root.render(<pre>{`unknown scene ${name}\n${Object.keys(SCENES).join('\n')}`}</pre>);
} else {
  const f = fixture();
  root.render(
    <main className="skyline-invaders skyline-invaders--play" data-harness-ready>
      <InvadersScene state={f.state} level={f.level} aim={f.aim} twin={f.twin} tier={f.tier.tier} effects={f.effects} />
      <InvadersHud state={f.state} level={f.level} tier={f.tier} aimStatus={f.aimStatus} poseStatus={{ state: 'detecting' }} partner={f.partner} shooterName={f.shooterName} />
      {f.effects?.banner && <MomentBanner text={f.effects.banner.text} momentKey={f.effects.banner.key} className="skyline-invaders__banner" />}
    </main>,
  );
}
