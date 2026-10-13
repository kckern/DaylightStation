// practiceModes.js — the practice ladder for ModeSheet.jsx (and ScorePlayer.jsx,
// which reads it directly), split out so Fast Refresh can hot-reload the mode
// picker sheet on its own.

// The practice ladder, selected from the header's mode crumb (wave-2 B).
export const MODES = [
  { id: 'listen', label: 'Listen', icon: 'mode-listen' },
  { id: 'learn', label: 'Learn', icon: 'mode-learn' },
  { id: 'polish', label: 'Polish', icon: 'mode-polish' },
  { id: 'perform', label: 'Perform', icon: 'mode-perform' },
];
