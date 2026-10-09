// pianoModes.js — the piano home screen's tile roster, split out so Fast
// Refresh can hot-reload PianoMenu.jsx on its own.

// Order maps to the 4-column grid, row by row (top row → bottom row):
//   Courses    Music      Sheet Music  Studio
//   Composer   Playalong  Singalong    Karaoke
//   Training   Games      Producer
// Training sits directly under Playalong; Music follows Courses; Composer
// follows Studio. Karaoke sits next to Singalong (same mic icon, both are
// karaoke-chrome playback — Karaoke is the searchable song browser, Singalong
// the poster-grid collection). Producer is present but `disabled` (greyed,
// non-clickable) — it stays reachable only via the `producer/*` route (see
// PianoApp.jsx), not the touch UI, until it ships. Composer is a placeholder
// shell for a future tool.
//
export const PIANO_MODES = [
  { id: 'videos', label: 'Courses', blurb: 'Watch lessons & lectures', icon: 'video' },
  { id: 'music', label: 'Music', blurb: 'Albums & playlists', icon: 'music' },
  { id: 'sheetmusic', label: 'Sheet Music', blurb: 'Scores to play', icon: 'sheet-music' },
  { id: 'studio', label: 'Studio', blurb: 'Free play, record & replay', icon: 'studio' },
  { id: 'composer', label: 'Composer', blurb: 'Write & arrange music', icon: 'quill' },
  { id: 'playalong', label: 'Playalong', blurb: 'Backing tracks to play over', icon: 'playalong' },
  { id: 'singalong', label: 'Karaoke', blurb: 'Grab the mic — sing along', icon: 'singalong' },
  { id: 'exercises', label: 'Exercises', blurb: 'Drills, scales & chords', icon: 'metronome' },
  { id: 'games', label: 'Games', blurb: 'Play note-driven games', icon: 'game' },
  { id: 'producer', label: 'Producer', blurb: 'Coming soon', icon: 'producer', disabled: true },
];
