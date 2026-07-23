// The four content kinds a subject's shelf is partitioned into, in the order
// they render after the Continue rail. `verb` is the section header; `icon` is
// the glyph name (Phase 0); `token` maps to a `--kind-*` colour. The per-kind
// `Tile` component is added in Phase 3 (Task 3.5).
export const KINDS = [
  { id: 'video', verb: 'Watch', descriptor: 'Video courses', icon: 'kind-video', token: 'video' },
  { id: 'audio', verb: 'Listen', descriptor: 'Audio courses', icon: 'kind-audio', token: 'audio' },
  { id: 'apps', verb: 'Apps', descriptor: 'Play & practice', icon: 'kind-app', token: 'app' },
  { id: 'decks', verb: 'Practice', descriptor: 'Quizzes & flashcards', icon: 'kind-deck', token: 'deck' },
];

// Partition a subject shelf (materials/banks/courses) + first-class programs
// into the four kinds. Media split by `medium`; apps = programs then language
// courses; decks = banks. Null-safe: missing pieces become empty arrays.
export function groupByKind({ shelf, programs = [] } = {}) {
  const materials = shelf?.materials ?? [];
  return {
    video: materials.filter((m) => m.medium === 'video'),
    audio: materials.filter((m) => m.medium === 'audio'),
    apps: [...programs, ...(shelf?.courses ?? [])],
    decks: shelf?.banks ?? [],
  };
}
