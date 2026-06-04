/**
 * Panel descriptor registry for the race director. Each panel declares where it
 * can live (zones, best-first), how big it wants to be, whether it can share a
 * zone via rotation, and pure candidacy/priority functions over the snapshot.
 * Transient panels (camera) carry hold/cooldown timing the director enforces.
 */
const CAMERA_TRIGGERS = ['LAPPING_IMMINENT', 'PHOTO_FINISH'];

export const RACE_PANELS = [
  {
    id: 'speedoRow', zones: ['bottom'], sizeHint: 'wide', cycles: false,
    candidacy: () => true, priority: () => 100, transient: null
  },
  {
    id: 'distanceChart', zones: ['topLeft', 'topCenter'], sizeHint: 'standard', cycles: true,
    // Shows with competitors (the race), and also solo when there's no lap table
    // to take the stage — a single climbing line still reads as pace toward the
    // goal. Only suppressed for a solo race WITH laps (lapTable is the better view).
    candidacy: (s) => s.fieldSize >= 2 || !s.lapsEnabled,
    priority: (s) => 50 + Math.min(20, (s.leaderGapM || 0) * 0.02), transient: null
  },
  {
    id: 'rankings', zones: ['topRight', 'topCenter'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => s.fieldSize >= 2, // ghosts count toward fieldSize
    priority: (s) => 45 + Math.min(30, (s.leaderGapM || 0) * 0.05), transient: null
  },
  {
    id: 'lapPanel', zones: ['topLeft', 'topCenter', 'topRight'], sizeHint: 'wide', cycles: true,
    // Combined velodrome oval (whole-race loop) + growing lap-split table as one
    // lap-context unit. Laps-gated; boosted when solo (the lap view is the star of
    // a solo lap race). Replaces the former separate lapTable + ovalTrack panels.
    candidacy: (s) => !!s.lapsEnabled,
    priority: (s) => (s.isSolo ? 80 : 40), transient: null
  },
  {
    id: 'racePistons', zones: ['topCenter', 'topLeft', 'topRight'], sizeHint: 'wide', cycles: true,
    // Relative-standings "piston" bars — leader pinned to the right edge, the field
    // trailing; needs competitors (ghosts count) to read as a race.
    candidacy: (s) => s.fieldSize >= 2,
    priority: (s) => 44 + Math.min(22, (s.leaderGapM || 0) * 0.04), transient: null
  },
  {
    id: 'cameraZoom', zones: ['topCenter'], sizeHint: 'focus', cycles: false,
    candidacy: (s) => (s.events || []).some((e) => CAMERA_TRIGGERS.includes(e.type)),
    priority: () => 200, // wins the focus zone when active
    transient: { minHoldS: 6, cooldownS: 10, triggers: CAMERA_TRIGGERS }
  }
];

export function panelById(id) {
  return RACE_PANELS.find((p) => p.id === id) || null;
}

export default RACE_PANELS;
