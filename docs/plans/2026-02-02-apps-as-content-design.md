# Apps as Content Sources - Design

**Date:** 2026-02-02
**Status:** Draft
**Priority:** P1

## Overview

Apps become selectable content items through an **AppAdapter** that exposes registered apps as a content source. Apps can have typed parameters that the admin UI renders appropriately.

### ID Format

```
app:family-selector          # No param
app:family-selector/dad      # With param
app:art/nativity             # String param
app:webcam                   # No param
```

---

## App Registry

**Location:** `backend/config/apps.yml` (system config - apps are part of codebase)

```yaml
apps:
  family-selector:
    label: Family Selector
    description: Roulette wheel for picking household members
    param:
      name: winner
      type: household-member
      optional: true

  art:
    label: Art Display
    description: Full-screen artwork display
    param:
      name: path
      type: string
      label: Art path
      optional: true

  webcam:
    label: Webcam
    description: Live webcam feed
    # No param

  glympse:
    label: Glympse Map
    description: Location tracking display
    param:
      name: id
      type: string
      label: Glympse ID
      required: true

  gratitude:
    label: Gratitude
    description: Family gratitude journal

  wrapup:
    label: Wrap Up
    description: End of day routine

  office_off:
    label: Office Off
    description: Office shutdown routine

  keycode:
    label: Key Test
    description: Keyboard input testing

  websocket:
    label: WebSocket Test
    description: WebSocket connection testing
    param:
      name: path
      type: string
      optional: true
```

### Param Types

| Type | UI Component | Description |
|------|--------------|-------------|
| `string` | TextInput | Freeform text input |
| `household-member` | Select dropdown | Fetches from `/api/v1/household/members` |
| Future: `content-id` | Content search picker | Any content source item |
| Future: `local-path` | File browser | LocalMediaAdapter integration |
| Future: `list-id` | List picker | ListAdapter integration |

### Param Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Param name passed to app component |
| `type` | string | Yes | Type for UI picker selection |
| `label` | string | No | Display label in UI (defaults to name) |
| `optional` | boolean | No | Whether param can be omitted (default: false) |
| `required` | boolean | No | Explicit required flag (default: false) |

---

## AppAdapter

Implements standard content source interface.

```javascript
class AppAdapter {
  source = 'app';
  prefixes = [{ prefix: 'app' }];

  /**
   * List all registered apps
   */
  async getList(id) {
    if (!id || id === 'app:') {
      return appsFromRegistry.map(app => ({
        id: `app:${app.name}`,
        source: 'app',
        title: app.label,
        itemType: 'leaf',
        metadata: {
          category: ContentCategory.APP,
          description: app.description,
          hasParam: !!app.param,
          paramType: app.param?.type,
          paramRequired: app.param?.required || false
        }
      }));
    }
    return null;
  }

  /**
   * Get single app by ID
   */
  async getItem(id) {
    const [appName, param] = id.replace('app:', '').split('/');
    const app = registry[appName];
    if (!app) return null;

    return {
      id: param ? `app:${appName}/${param}` : `app:${appName}`,
      source: 'app',
      title: app.label,
      itemType: 'leaf',
      metadata: {
        category: ContentCategory.APP,
        description: app.description,
        param: param || null,
        paramConfig: app.param || null
      }
    };
  }

  /**
   * Search apps by name/label
   */
  async search(query) {
    const text = query.text?.toLowerCase() || '';
    const matches = Object.entries(registry)
      .filter(([name, app]) =>
        name.includes(text) ||
        app.label.toLowerCase().includes(text) ||
        app.description?.toLowerCase().includes(text)
      )
      .map(([name, app]) => ({
        id: `app:${name}`,
        source: 'app',
        title: app.label,
        itemType: 'leaf',
        metadata: {
          category: ContentCategory.APP,
          description: app.description,
          hasParam: !!app.param
        }
      }));

    return { items: matches, total: matches.length };
  }

  getSearchCapabilities() {
    return { canonical: ['text'], specific: [] };
  }
}
```

---

## Relevance Scoring

New category in `ContentCategory.mjs`:

```javascript
APP: 'app'  // Score: 35 (below LIST:40, above MEDIA:30)
```

Apps rank below lists but above individual media items in search results.

---

## API Endpoints

```
GET /api/v1/apps              # List all registered apps
GET /api/v1/apps/:name        # Get single app with param config
```

### List Response

```json
{
  "apps": [
    {
      "name": "family-selector",
      "label": "Family Selector",
      "description": "Roulette wheel for picking household members",
      "param": {
        "name": "winner",
        "type": "household-member",
        "optional": true
      }
    },
    {
      "name": "webcam",
      "label": "Webcam",
      "description": "Live webcam feed"
    }
  ]
}
```

### Single App Response

```json
{
  "name": "family-selector",
  "label": "Family Selector",
  "description": "Roulette wheel for picking household members",
  "param": {
    "name": "winner",
    "type": "household-member",
    "optional": true
  }
}
```

---

## Admin UI Integration

### Two-Step Selection Flow

**Step 1: Select app from autocomplete**
- User types in input field (e.g., "family")
- Autocomplete shows `app:family-selector` from AppAdapter search
- User selects, input field shows `app:family-selector`

**Step 2: Param picker appears (if app has param)**
- After selection, check if app has param config
- Render appropriate picker below input field
- Combined value updates input: `app:family-selector/dad`

### AppParamPicker Component

```jsx
function AppParamPicker({ paramConfig, value, onChange }) {
  const { type, name, label, optional } = paramConfig;

  if (type === 'household-member') {
    return (
      <HouseholdMemberSelect
        label={label || name}
        value={value}
        onChange={onChange}
        required={!optional}
      />
    );
  }

  if (type === 'string') {
    return (
      <TextInput
        label={label || name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={!optional}
      />
    );
  }

  // Unknown type - fall back to string
  return (
    <TextInput
      label={label || name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
```

### ListsItemEditor Changes

```jsx
// After input TextInput
{selectedApp?.param && (
  <AppParamPicker
    paramConfig={selectedApp.param}
    value={paramValue}
    onChange={(val) => {
      const newInput = val
        ? `app:${appName}/${val}`
        : `app:${appName}`;
      handleInputChange('input', newInput);
    }}
  />
)}
```

---

## Action Handling

Menu item with `action: Open` and `input: app:family-selector/dad`:

1. Frontend receives action via existing command dispatch
2. Parses input: `app:family-selector/dad` → app="family-selector", param="dad"
3. Calls AppContainer with `{ app: 'family-selector', param: 'dad' }`
4. AppContainer renders `<FamilySelector winner="dad" />`

**No changes to AppContainer.jsx** - existing if/else pattern handles dispatch. The registry is for:
- Admin UI (search, param pickers)
- Content source integration (search results)

Runtime app loading remains unchanged.

---

## Menu Item Examples

```yaml
# Open app without param
- label: Webcam
  input: app:webcam
  action: Open

# Open app with typed param
- label: Dad's Turn
  input: app:family-selector/dad
  action: Open

# Open app with string param
- label: Nativity Art
  input: app:art/nativity
  action: Open
```

---

## Future Extensions

### New Param Types

As LocalMediaAdapter and ListAdapter are implemented:

```yaml
# content-id - any content source item
param:
  name: contentId
  type: content-id

# local-path - file from LocalMediaAdapter
param:
  name: videoPath
  type: local-path
  mediaType: video  # Optional filter

# list-id - reference to a list
param:
  name: playlist
  type: list-id
  listType: menu  # Optional filter
```

### Dynamic App Registration

Future: Apps could self-register their param schemas via a manifest file in their directory, eliminating the central registry.

---

## Implementation Notes

1. **Registry loading** - Load `apps.yml` at startup, cache in memory
2. **Param validation** - Validate param values match type constraints before saving
3. **Backward compatibility** - Existing `app:name/param` format continues to work
4. **Search integration** - AppAdapter registered in ContentSourceRegistry alongside Plex, Immich, etc.
