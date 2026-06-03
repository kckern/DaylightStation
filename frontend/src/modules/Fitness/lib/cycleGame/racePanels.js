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
    candidacy: (s) => s.fieldSize >= 2,
    priority: (s) => 50 + Math.min(20, (s.leaderGapM || 0) * 0.02), transient: null
  },
  {
    id: 'rankings', zones: ['topRight', 'topCenter'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => s.fieldSize >= 2, // ghosts count toward fieldSize
    priority: (s) => 45 + Math.min(30, (s.leaderGapM || 0) * 0.05), transient: null
  },
  {
    id: 'lapTable', zones: ['topLeft', 'topCenter', 'topRight'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => !!s.lapsEnabled,
    priority: (s) => (s.isSolo ? 80 : 40), transient: null
  },
  {
    id: 'ovalTrack', zones: ['topCenter', 'topLeft'], sizeHint: 'standard', cycles: true,
    candidacy: (s) => !!s.lapsEnabled && s.fieldSize >= 2,
    priority: (s) => 42 + Math.min(25, (s.lapDeltaMax || 0) * 15), transient: null
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
