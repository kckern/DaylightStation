// artModes.js — pure view-mode model + object-fit geometry for ArtMode. No DOM.
// Five modes cycle museum → immersive.

export const VIEW_MODES = [
  { name: 'gallery',        frame: true,  fullWindow: false, fit: 'gallery', placard: true  },
  { name: 'framed-contain', frame: true,  fullWindow: false, fit: 'contain', placard: true  },
  { name: 'framed-cover',   frame: true,  fullWindow: false, fit: 'cover',   placard: true  },
  { name: 'bare-contain',   frame: false, fullWindow: true,  fit: 'contain', placard: false },
  { name: 'bare-cover',     frame: false, fullWindow: true,  fit: 'cover',   placard: false },
];

export function modeIndexByName(name) {
  const i = VIEW_MODES.findIndex((m) => m.name === name);
  return i === -1 ? 0 : i;
}

export const nextMode = (i) => (i + 1) % VIEW_MODES.length;
export const prevMode = (i) => (i - 1 + VIEW_MODES.length) % VIEW_MODES.length;

// Per-panel window insets (% of stage) for the object-fit modes (2-5).
// count: 1 single | 2 diptych. fullWindow: true → full stage, else frame insets.
export function objectFitWindows({ count, frame, fullWindow }) {
  const win = fullWindow ? { top: 0, right: 0, bottom: 0, left: 0 } : frame;
  const openLeft = win.left;
  const openRight = 100 - win.right;
  const openWidth = openRight - openLeft;
  if (count === 2) {
    const mid = openLeft + openWidth / 2;
    return [
      { top: win.top, bottom: win.bottom, left: win.left, right: 100 - mid,
        centerXPct: (openLeft + mid) / 2, widthPct: openWidth / 2 },
      { top: win.top, bottom: win.bottom, left: mid, right: win.right,
        centerXPct: (mid + openRight) / 2, widthPct: openWidth / 2 },
    ];
  }
  return [
    { top: win.top, bottom: win.bottom, left: win.left, right: win.right,
      centerXPct: openLeft + openWidth / 2, widthPct: openWidth },
  ];
}

export default VIEW_MODES;
