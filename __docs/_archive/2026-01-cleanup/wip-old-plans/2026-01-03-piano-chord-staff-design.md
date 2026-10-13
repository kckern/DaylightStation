# Piano Live Chord Staff Display

## Overview

Replace the text note display in PianoVisualizer header with a live-rendered grand staff showing currently pressed notes as a quarter-note chord using abcjs.

## Requirements

- Show notes on a grand staff (treble/bass clefs)
- Split at C4 (MIDI 60): notes < 60 on bass clef, notes >= 60 on treble clef
- Quarter note visualization, no time signature, no rests
- Hidden until first note played, then stays visible
- Dev keyboard input for localhost testing

## Component Structure

### New Files

- `frontend/src/modules/Piano/components/CurrentChordStaff.jsx`
- `frontend/src/modules/Piano/components/CurrentChordStaff.scss`

### CurrentChordStaff Component

```jsx
// Props: activeNotes (Map), noteHistory (array)
// Returns null until noteHistory.length > 0
// Renders abcjs grand staff with current chord
```

### Integration

In `PianoVisualizer.jsx`, replace:
```jsx
<div className="current-notes">
  {currentNotesDisplay || <span className="placeholder">Play something...</span>}
</div>
```

With:
```jsx
<CurrentChordStaff activeNotes={activeNotes} noteHistory={noteHistory} />
```

Remove the `currentNotesDisplay` useMemo.

## ABC Notation

### MIDI to ABC Conversion

| MIDI | Note | ABC |
|------|------|-----|
| 48 | C3 | `C,` (bass) |
| 60 | C4 | `C` (treble) |
| 72 | C5 | `c` (treble) |
| 84 | C6 | `c'` (treble) |

### ABC Template

```abc
X:1
L:1/4
M:none
%%staves {(RH) (LH)}
V:RH clef=treble
V:LH clef=bass
[V:RH] [CEG]
[V:LH] [C,E,G,]
```

- Only render clefs that have notes
- When no notes pressed (after having played): show empty grand staff

## Rendering

```js
abcjs.renderAbc(element, abcString, {
  staffwidth: 100,
  paddingtop: 0,
  paddingbottom: 0,
  paddingleft: 0,
  paddingright: 0,
  add_classes: true,
  responsive: 'resize'
});
```

Container: ~80-120px wide, ~60px tall in header.

## Dev Keyboard Input

Only active when `window.location.hostname === 'localhost'`.

### Key Mapping (Main Number Row)

| Key | MIDI | Note |
|-----|------|------|
| 1 | 60 | C4 |
| 2 | 62 | D4 |
| 3 | 64 | E4 |
| 4 | 65 | F4 |
| 5 | 67 | G4 |
| 6 | 69 | A4 |
| 7 | 71 | B4 |
| 8 | 72 | C5 |
| 9 | 74 | D5 |
| 0 | 76 | E5 |
| - | 77 | F5 |
| = | 79 | G5 |

### Numpad 0

Triggers PianoVisualizer open (handled at parent component level).

### Implementation

- Add keyboard handling in `useMidiSubscription.js`
- `keydown` adds note to activeNotes and noteHistory
- `keyup` removes note from activeNotes
- Parent component listens for numpad 0 to toggle visualizer

## Dependencies

```bash
npm install abcjs
```

## Implementation Steps

1. Install abcjs package
2. Create CurrentChordStaff component with MIDI-to-ABC conversion
3. Create CurrentChordStaff.scss for sizing/styling
4. Update PianoVisualizer.jsx to use CurrentChordStaff
5. Add dev keyboard listener to useMidiSubscription.js
6. Add numpad 0 listener to parent component for visualizer toggle
7. Test with keyboard input on localhost
