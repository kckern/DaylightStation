import SkylineInvaders from "./SkylineInvaders.jsx";

export default SkylineInvaders;
export const manifest = {
  id: 'skyline_invaders', name: 'Skyline Invaders', icon: '👾',
  description: 'Aim with your arms, step to fire, defend the skyline.',
  // Covers the whole viewport, nav included: it is played from across the garage.
  fullscreen: true,
  modes: { standalone: true, overlay: false, sidebar: false, mini: false },
  // Declarative only: nothing in the shell reads `requires` today. Camera
  // absence is handled inside the game (gamepad aim), never by blocking.
  requires: { sessionActive: true, participants: true, camera: true },
  category: 'games',
};
