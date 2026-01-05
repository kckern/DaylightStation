# Key Detection for Piano Chord Staff

## Overview

Add automatic key detection to the CurrentChordStaff component, displaying detected key signatures and adjusting note accidentals accordingly.

## Design Decisions

1. **Scope**: Rolling window analysis of recent notes (last 10 seconds or ~30 notes)
2. **Display**: Full notation with key signature symbols and adjusted accidentals
3. **Keys supported**: Major keys and their relative minors

## Algorithm

### Key Detection

- Maintain a rolling buffer of recent pitch classes (0-11)
- Score each major scale by counting how many buffer notes fit
- Apply hysteresis: new key must score ≥20% better than current to switch
- Minimum 5 unique pitch classes before attempting detection

### Scoring

For each candidate key, count notes that belong to its major scale:
- C major: C, D, E, F, G, A, B (0, 2, 4, 5, 7, 9, 11)
- G major: G, A, B, C, D, E, F# (7, 9, 11, 0, 2, 4, 6)
- etc.

The key with the highest percentage of matching notes wins.

## Data Structures

```javascript
const KEY_SIGNATURES = {
  'C':  { sharps: [], flats: [], scale: [0, 2, 4, 5, 7, 9, 11] },
  'G':  { sharps: [6], flats: [], scale: [7, 9, 11, 0, 2, 4, 6] },
  'D':  { sharps: [6, 1], flats: [], scale: [2, 4, 6, 7, 9, 11, 1] },
  'A':  { sharps: [6, 1, 8], flats: [], scale: [9, 11, 1, 2, 4, 6, 8] },
  'E':  { sharps: [6, 1, 8, 3], flats: [], scale: [4, 6, 8, 9, 11, 1, 3] },
  'B':  { sharps: [6, 1, 8, 3, 10], flats: [], scale: [11, 1, 3, 4, 6, 8, 10] },
  'F':  { sharps: [], flats: [10], scale: [5, 7, 9, 10, 0, 2, 4] },
  'Bb': { sharps: [], flats: [10, 3], scale: [10, 0, 2, 3, 5, 7, 9] },
  'Eb': { sharps: [], flats: [10, 3, 8], scale: [3, 5, 7, 8, 10, 0, 2] },
  'Ab': { sharps: [], flats: [10, 3, 8, 1], scale: [8, 10, 0, 1, 3, 5, 7] }
};
```

## State Management

```javascript
const [detectedKey, setDetectedKey] = useState('C');
const noteBufferRef = useRef([]);
const BUFFER_MAX_AGE = 10000; // 10 seconds
const BUFFER_MAX_NOTES = 30;
```

## ABC Notation Changes

Before:
```
X:1
L:1/4
M:none
V:RH clef=treble
...
```

After:
```
X:1
L:1/4
M:none
K:G
V:RH clef=treble
...
```

## Note Conversion

`midiToAbc` will be extended to accept key context:
- Notes in key: render without accidentals
- Notes out of key: add explicit accidental (natural, sharp, or flat)

Example in G major:
- F# (MIDI 66) → `f` (no accidental needed, F# is in key)
- F natural (MIDI 65) → `=f` (natural sign needed)

## Integration Points

1. When `displayNotes` changes with notes present, add pitch classes to buffer
2. Prune buffer entries older than 10 seconds
3. Recalculate key when buffer has ≥5 unique pitch classes
4. Pass `detectedKey` to `generateAbc()`
5. ABC string includes `K:${detectedKey}` header

## No New Props

The component self-manages key detection from the notes it already receives via `activeNotes` prop.
