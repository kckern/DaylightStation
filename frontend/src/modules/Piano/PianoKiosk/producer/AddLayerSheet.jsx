import './AddLayerSheet.scss';

// The unified "add a layer" entry (design §8): browse the library by role, record
// a new layer, or build one from scratch. One door, not a scattered set. Role
// cards use the shared role-color system (Chords/Bass/Drums/Melody).
const ROLES = [
  { role: 'chords', label: 'Chords', glyph: '𝄞' },
  { role: 'bass', label: 'Bass', glyph: '𝄢' },
  { role: 'groove', label: 'Drums', glyph: '🥁' },
  { role: 'melody', label: 'Melody', glyph: '♪' },
];

/**
 * @param {(role:string) => void} onPickRole   browse the library filtered by role
 * @param {() => void} onRecord                open the record flow
 * @param {() => void} [onBuildDrums]          open the drum step-sequencer
 * @param {() => void} [onBuildChords]         open the chord builder
 * @param {() => void} onClose
 */
export function AddLayerSheet({ onPickRole, onRecord, onBuildDrums, onBuildChords, onClose }) {
  return (
    <div className="piano-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="piano-sheet piano-add-layer"
        role="dialog"
        aria-label="add a layer"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="piano-add-layer__title">Add a layer</h2>

        <div className="piano-add-layer__roles" role="group" aria-label="browse by part">
          {ROLES.map((r) => (
            <button
              key={r.role}
              type="button"
              className="piano-add-layer__role"
              data-role={r.role}
              onClick={() => onPickRole(r.role)}
            >
              <span className="piano-add-layer__role-glyph" aria-hidden="true">{r.glyph}</span>
              <span className="piano-add-layer__role-label">{r.label}</span>
            </button>
          ))}
        </div>

        <div className="piano-add-layer__makers">
          <button type="button" className="piano-add-layer__maker" onClick={onRecord}>
            <span aria-hidden="true">🎙</span> Record a new layer
          </button>
          <button
            type="button"
            className="piano-add-layer__maker"
            disabled={!onBuildDrums}
            title={onBuildDrums ? undefined : 'Coming soon'}
            onClick={onBuildDrums}
          >
            <span aria-hidden="true">🥁</span> Build a drum loop
          </button>
          <button
            type="button"
            className="piano-add-layer__maker"
            disabled={!onBuildChords}
            title={onBuildChords ? undefined : 'Coming soon'}
            onClick={onBuildChords}
          >
            <span aria-hidden="true">🎹</span> Build chords
          </button>
        </div>

        <button type="button" className="piano-sheet__done piano-add-layer__cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default AddLayerSheet;
