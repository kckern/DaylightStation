# List Parameters Editor Design

## Overview

Extend the ContentLists admin UI to support editing all list item parameters (playback, scheduling, display, etc.) through a two-mode editor while showing parameter status in the table view.

## Mode Structure

### Simple Mode (Default)
The current editor, unchanged:
- label, input, action, active, image, group

### Full Mode
Comprehensive form with collapsible categories:
- **Identity**: label, input, action, active, group, image
- **Playback**: shuffle, continuous, loop, fixedOrder, volume, playbackRate
- **Scheduling**: days, snooze, waitUntil
- **Display**: shader, composite, playable
- **Progress**: progress %, watched (read-only with override option)
- **Custom**: key-value editor for unknown YAML fields

Toggle via SegmentedControl at top of modal: `[ Simple | Full ]`

## Full Mode Layout

Modal expands from `md` to `lg` size. Categories are collapsible accordions.

```
┌─────────────────────────────────────────────────────────┐
│  Edit Item                          [ Simple | Full ]   │
├─────────────────────────────────────────────────────────┤
│  ▼ Identity                                             │
│    Label [___________]    Input [___________]           │
│    Action [▼]  Group [▼]  Active [○]  Image [📁]        │
├─────────────────────────────────────────────────────────┤
│  ▼ Playback                                             │
│    [○ Shuffle] [○ Continuous] [○ Loop] [○ Fixed Order]  │
│    Volume [====50%====]    Rate [====1.0x====]          │
├─────────────────────────────────────────────────────────┤
│  ▶ Scheduling                                           │
├─────────────────────────────────────────────────────────┤
│  ▶ Display                                              │
├─────────────────────────────────────────────────────────┤
│  ▶ Progress                                             │
├─────────────────────────────────────────────────────────┤
│  ▶ Custom                                               │
├─────────────────────────────────────────────────────────┤
│                              [ Cancel ]  [ Save ]       │
└─────────────────────────────────────────────────────────┘
```

### Component Types
- Switches: shuffle, continuous, loop, fixedOrder, active, watched, composite, playable
- Sliders + number input: volume (0-100), playbackRate (0.5-3.0)
- Chip.Group multi-select: days (individual + presets)
- DatePickerInput: waitUntil
- Duration picker: snooze (number + unit)
- Select dropdown: shader, action

## Table View

### New Columns

Two new columns before the menu:

| Column | Width | Purpose |
|--------|-------|---------|
| 📊 Progress | ~60px | Watchlists only, display-only |
| ⚙️ Config | ~40px | Config indicators for all list types |

### Table Layout

```
│ ○ │⋮⋮│ # │ Label              │ Action │ Input       │ 📊    │ ⚙️  │ ⋯ │
│ ✓ │⋮⋮│ 1 │ Stinky and Dirty   │ Queue  │ plex:585114 │       │ 🔀🔁│ ⋯ │
│ ✓ │⋮⋮│ 2 │ Holy Moly          │ Queue  │ plex:456598 │       │ 📅+1│ ⋯ │
│ ✓ │⋮⋮│ 3 │ Growing up Social  │ Play   │ plex:311549 │ ██░ 75│     │ ⋯ │
```

### Progress Column (Watchlists Only)
- Mini horizontal bar (40px) + percentage
- Checkmark icon when `watched: true`
- Display-only (not clickable)
- Tooltip: "Progress tracked automatically via media_memory"

### Config Column (All List Types)
- Shows max 2 icons + "+N" overflow
- Priority order determines which icons show
- Hover shows tooltip with all active parameters
- Click opens editor in Full mode

### Icon Priority Order
1. 📅 days - scheduling affects when item appears
2. ⏸️ snooze/waitUntil - item is deferred
3. 🔀 shuffle - changes playback behavior
4. 🔁 continuous/loop - changes playback behavior
5. 🔊 volume - only if notably different
6. ⚡ playbackRate - only if != 1.0
7. 🎨 shader - display modifier

### Icon Visual Treatment
- 14px Tabler icons, `dimmed` color
- "+N" badge is 11px, same gray
- Subtle hover state on cell

## Data Handling

### Principle
Preserve all YAML fields. Only write non-default values.

### Known Fields
Form manages these explicitly with typed state.

### Unknown Fields
Captured in `customFields` object, merged on save.

### Save Payload Construction
```js
const buildSavePayload = () => {
  const payload = { label, input };

  // Only include non-defaults
  if (action !== 'Play') payload.action = action;
  if (!active) payload.active = false;
  if (shuffle) payload.shuffle = true;
  if (volume !== 100) payload.volume = volume;
  // ... etc

  // Merge custom fields
  Object.assign(payload, customFields);

  return payload;
};
```

## Custom Fields UI

For unknown YAML keys. Only in Full mode, collapsed by default.

```
│  ▶ Custom (2 fields)                                    │
├─────────────────────────────────────────────────────────┤
│   [key_______]  [value________________]  [✕]            │
│   [key_______]  [value________________]  [✕]            │
│   + Add custom field                                    │
│   ⚠️ Custom fields are passed through as-is.           │
```

- Key validates against reserved field names
- Value stored as string, backend interprets type
- Warning text explains bypass of validation

## Validation & Defaults

### Identity
| Field | Default | Validation |
|-------|---------|------------|
| label | `""` | Required |
| input | `""` | Required |
| action | `"Play"` | Enum |
| active | `true` | Boolean |
| group | `null` | String |
| image | `null` | URL/path |

### Playback
| Field | Default | Validation |
|-------|---------|------------|
| shuffle | `false` | Boolean |
| continuous | `false` | Boolean |
| loop | `false` | Boolean |
| fixedOrder | `false` | Boolean |
| volume | `100` | 0-100 |
| playbackRate | `1.0` | 0.5-3.0 |

### Scheduling
| Field | Default | Validation |
|-------|---------|------------|
| days | `null` | Preset string or day list |
| snooze | `null` | Duration string |
| waitUntil | `null` | ISO date, future |

### Display
| Field | Default | Validation |
|-------|---------|------------|
| shader | `null` | Enum from config |
| composite | `false` | Boolean |
| playable | `true` | Boolean |

### Progress (Override Only)
| Field | Default | Validation |
|-------|---------|------------|
| progress | `null` | 0-100 |
| watched | `false` | Boolean |

### Days Format
Supports presets and individual days:
- Presets: "Weekdays", "Weekend", "Daily"
- Individual: "Sun", "M•W•F", "T•Th"

## Progress Override UX

Progress is derived from `media_memory`. Manual override is discouraged.

In Full mode Progress category:
- Shows current values as read-only
- Collapsed "Override progress..." link
- Expands with warning: "Manual overrides may be reset when media is played"

## Files to Modify

### Frontend
- `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx` - Two-mode editor
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` - Add indicator icons
- `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` - Add columns
- `frontend/src/modules/Admin/ContentLists/ContentLists.scss` - New column styles

### Backend (if needed)
- Ensure API passes through all YAML fields without filtering
- May need shader list endpoint if not already available
