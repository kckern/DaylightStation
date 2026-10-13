/** Pure closed surface validation registry; no household/hardware dependencies. */
import { PortalSurface } from "./application/surfaces/PortalSurface.mjs";
import { ThermalSurface } from "./application/surfaces/ThermalSurface.mjs";
import { LaserSurface } from "./application/surfaces/LaserSurface.mjs";
import { PlaybackHubSurface } from "./application/surfaces/PlaybackHubSurface.mjs";
import { LivingroomTvSurface } from "./application/surfaces/LivingroomTvSurface.mjs";
import { GarageFitnessSurface } from "./application/surfaces/GarageFitnessSurface.mjs";
import { PianoKioskSurface } from "./application/surfaces/PianoKioskSurface.mjs";

export function createDoNowActionValidators() {
  const surfaces = [
    new PortalSurface(), new ThermalSurface(), new LaserSurface(),
    new PlaybackHubSurface(), new LivingroomTvSurface(), new GarageFitnessSurface(),
    new PianoKioskSurface(),
  ];
  return new Map(surfaces.map((s) => [s.id, (raw) => s.validateAction(raw)]));
}
