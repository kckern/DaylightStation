# Playback Hub Admin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Playback Hub admin (frontend page + supporting backend) per `docs/_wip/plans/2026-05-27-playback-hub-admin-design.md` — letting the household admin live-monitor and remote-control the playback-hub at `kckern-playback-hub:8080`, with Plex-aware content browsing instead of raw IDs.

**Architecture:** DDD-layered backend (`2_domains/playback-hub/` value-objects + entities, `3_applications/playback-hub/` ports + use cases + container + broadcaster service, `1_adapters/playback-hub/` HTTP gateway + YAML datastore, `4_api/v1/routers/playbackHub.mjs` thin router). Frontend at `frontend/src/modules/Admin/PlaybackHub/` with 5 device cards subscribing to the existing `wsService` for live status. Single `HubConfig` aggregate persists to `headset-hub.yml` in the Dropbox-synced path (hub rsyncs within 60s). Sub-PR retrofit of the existing `/ha/call` and `/ha/script` endpoints to a `CallHomeAssistantService` use case.

**Tech Stack:** Node.js / ESM backend, Vitest for tests, React + Mantine v7 + Tabler icons, the existing `wsService` singleton, `js-yaml` (already in deps) for YAML I/O, Python 3 with PyYAML on the validator parity side.

**Working on main per user directive — no worktree.**

---

## Pre-flight reading

Before starting Task 1, read these so the conventions are loaded:
1. `docs/_wip/plans/2026-05-27-playback-hub-admin-design.md` — full design, all sections
2. `docs/_wip/plans/2026-05-27-playback-hub-public-private-design.md` — hub-side context (already implemented)
3. `docs/reference/core/layers-of-abstraction/ddd-reference.md` — layering rules
4. `_extensions/playback-hub/validate_config.py` — the eleven validation rules we mirror in JS
5. `_extensions/playback-hub/devices.yml` — the live YAML shape
6. `backend/src/3_applications/fitness/FitnessContainer.mjs` (or any existing container) — for DI wiring pattern
7. `backend/src/4_api/v1/routers/homeAutomation.mjs` — the existing direct-gateway router we'll retrofit

---

## Phase 0: Test infrastructure (do once, then leave alone)

### Task 0.1: Create the shared validator-parity fixture directory

**Files:**
- Create: `tests/fixtures/playback-hub/valid/01-minimal.yml`
- Create: `tests/fixtures/playback-hub/valid/01-minimal.expected.json`
- Create: `tests/fixtures/playback-hub/valid/02-sparse-volume.yml`
- Create: `tests/fixtures/playback-hub/valid/02-sparse-volume.expected.json`
- Create: `tests/fixtures/playback-hub/invalid/01-not-a-mapping.yml`
- Create: `tests/fixtures/playback-hub/invalid/02-devices-empty.yml`
- Create: `tests/fixtures/playback-hub/invalid/03-duplicate-color.yml`
- Create: `tests/fixtures/playback-hub/invalid/04-duplicate-mac.yml`
- Create: `tests/fixtures/playback-hub/invalid/05-class-invalid.yml`
- Create: `tests/fixtures/playback-hub/invalid/06-public-no-ha-entity.yml`
- Create: `tests/fixtures/playback-hub/invalid/07-volume-bounds-bad.yml`
- Create: `tests/fixtures/playback-hub/invalid/08-scheduled-bad-target.yml`
- Create: `tests/fixtures/playback-hub/invalid/09-scheduled-missing-fields.yml`
- Create: `tests/fixtures/playback-hub/invalid/10-days-bad.yml`
- Create: `tests/fixtures/playback-hub/invalid/11-daylight-station-no-base-url.yml`
- Create: `tests/fixtures/playback-hub/README.md`

**Step 1: Write `README.md` explaining the fixture convention**

`tests/fixtures/playback-hub/README.md`:
```markdown
# Playback Hub validator-parity fixtures

Shared between `_extensions/playback-hub/validate_config.py` (Python) and
`backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs` (JS).

- `invalid/*.yml` — each must be REJECTED by both validators.
  Filename prefix `NN-` = rule index (matches the 11 rules in the design's
  Validation strategy section). File contents document the rule being tested.

- `valid/*.yml` — each must be ACCEPTED by both validators.
  Paired with `*.expected.json` showing the canonical normalized form
  (post-default-fill). Both validators must produce equivalent JSON.

Adding a new rule = adding a fixture in both sets AND adding the rejection
(or normalization) logic to both validators. CI catches drift.
```

**Step 2: Write the minimal valid fixture**

`tests/fixtures/playback-hub/valid/01-minimal.yml`:
```yaml
devices:
  - slot: 1
    color: red
    mac: "41:42:3A:E5:43:07"
    class: private
    queue: "674397"
```

`tests/fixtures/playback-hub/valid/01-minimal.expected.json`:
```json
{
  "devices": [
    { "slot": 1, "color": "red", "mac": "41:42:3A:E5:43:07",
      "class": "private", "queue": "674397" }
  ]
}
```

**Step 3: Write the sparse-volume fixture (tests default-fill normalization)**

`tests/fixtures/playback-hub/valid/02-sparse-volume.yml`:
```yaml
devices:
  - slot: 1
    color: red
    mac: "41:42:3A:E5:43:07"
    class: private
    volume:
      default: 40
      max: 70
```

`tests/fixtures/playback-hub/valid/02-sparse-volume.expected.json`:
```json
{
  "devices": [
    { "slot": 1, "color": "red", "mac": "41:42:3A:E5:43:07",
      "class": "private",
      "volume": { "default": 40, "max": 70 } }
  ]
}
```

(Note: `min` is NOT default-filled in the runtime JSON — both validators preserve sparse YAML.)

**Step 4: Write the 11 invalid fixtures**

Each fixture violates exactly one rule. Examples:

`tests/fixtures/playback-hub/invalid/01-not-a-mapping.yml`:
```yaml
- this-is-a-list-not-a-mapping
```

`tests/fixtures/playback-hub/invalid/02-devices-empty.yml`:
```yaml
devices: []
```

`tests/fixtures/playback-hub/invalid/03-duplicate-color.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
  - { slot: 2, color: red, mac: "41:42:9A:E3:65:73", class: private }
```

`tests/fixtures/playback-hub/invalid/04-duplicate-mac.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
  - { slot: 2, color: yellow, mac: "41:42:3A:E5:43:07", class: private }
```

`tests/fixtures/playback-hub/invalid/05-class-invalid.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: hybrid }
```

`tests/fixtures/playback-hub/invalid/06-public-no-ha-entity.yml`:
```yaml
devices:
  - { slot: 1, color: white, mac: "9C:0C:35:75:B7:75", class: public }
```

`tests/fixtures/playback-hub/invalid/07-volume-bounds-bad.yml`:
```yaml
devices:
  - slot: 1
    color: red
    mac: "41:42:3A:E5:43:07"
    class: private
    volume: { min: 80, max: 40 }
```

`tests/fixtures/playback-hub/invalid/08-scheduled-bad-target.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
scheduled:
  - { id: x, time: "07:00", target: orange, queue: "1" }
```

`tests/fixtures/playback-hub/invalid/09-scheduled-missing-fields.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
scheduled:
  - { id: x, target: red }
```

`tests/fixtures/playback-hub/invalid/10-days-bad.yml`:
```yaml
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
scheduled:
  - { id: x, time: "07:00", target: red, queue: "1", days: maybenever }
```

`tests/fixtures/playback-hub/invalid/11-daylight-station-no-base-url.yml`:
```yaml
daylight_station:
  request_timeout_sec: 5
devices:
  - { slot: 1, color: red, mac: "41:42:3A:E5:43:07", class: private }
```

**Step 5: Commit**

```bash
git add tests/fixtures/playback-hub/
git commit -m "test: playback-hub validator-parity fixture set (11 invalid + 2 valid)"
```

---

### Task 0.2: Wire Python validator parity test against the fixtures

**Files:**
- Create: `tests/playback-hub/test_validate_config_parity.py`

**Step 1: Write the test**

`tests/playback-hub/test_validate_config_parity.py`:
```python
"""
Asserts validate_config.py rejects every invalid/*.yml fixture and accepts
every valid/*.yml fixture, producing the canonical JSON in *.expected.json.

The JS-side parity test is in tests/playback-hub/test_yaml_datastore.mjs.
Both must stay in lockstep.
"""
import json
import subprocess
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent.parent / "fixtures" / "playback-hub"
VALIDATOR = Path(__file__).parent.parent.parent / "_extensions" / "playback-hub" / "validate_config.py"


def run_validator(yml_path):
    """Returns (returncode, stdout, stderr) tuple."""
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), str(yml_path)],
        capture_output=True, text=True, timeout=5
    )
    return result.returncode, result.stdout, result.stderr


def test_invalid_fixtures_all_rejected():
    """Every invalid/*.yml must exit non-zero."""
    invalid_files = sorted((FIXTURES / "invalid").glob("*.yml"))
    assert len(invalid_files) >= 11, f"expected at least 11 invalid fixtures, got {len(invalid_files)}"
    for f in invalid_files:
        rc, _, err = run_validator(f)
        assert rc != 0, f"fixture {f.name} should have been REJECTED but validator accepted it"
        assert "config validation failed" in err, f"fixture {f.name} rejected without the expected error prefix"


def test_valid_fixtures_all_accepted_and_canonical():
    """Every valid/*.yml must exit 0 and produce the matching .expected.json."""
    for yml_path in sorted((FIXTURES / "valid").glob("*.yml")):
        expected_path = yml_path.with_suffix(".expected.json")
        assert expected_path.exists(), f"missing expected JSON for {yml_path.name}"
        rc, stdout, err = run_validator(yml_path)
        assert rc == 0, f"fixture {yml_path.name} should have been ACCEPTED, but: {err}"
        actual = json.loads(stdout)
        expected = json.loads(expected_path.read_text())
        assert actual == expected, (
            f"fixture {yml_path.name} normalized to:\n{json.dumps(actual, indent=2)}\n"
            f"but expected:\n{json.dumps(expected, indent=2)}"
        )
```

**Step 2: Run the test to verify it passes against the current validator**

Run: `python -m pytest tests/playback-hub/test_validate_config_parity.py -v`
Expected: PASS for invalid fixtures (validator already rejects them). The valid fixtures may FAIL the canonical-JSON check if the current validator output differs from `.expected.json` — adjust the `.expected.json` files to match the validator's actual output, OR fix the validator if its normalization is wrong.

**Step 3: If `.expected.json` files need updating to match validator output**

Run each valid fixture manually and dump the output:
```bash
python _extensions/playback-hub/validate_config.py tests/fixtures/playback-hub/valid/01-minimal.yml | python -m json.tool > tests/fixtures/playback-hub/valid/01-minimal.expected.json
```

Verify the new `expected.json` is what we WANT canonically, then re-run the test.

**Step 4: Commit**

```bash
git add tests/playback-hub/test_validate_config_parity.py tests/fixtures/playback-hub/valid/*.expected.json
git commit -m "test: Python validator parity against shared fixtures"
```

---

## Phase 1: Domain layer (`2_domains/playback-hub/`)

All Phase 1 tasks are pure domain — no I/O, no framework dependencies. Test files in `tests/domains/playback-hub/`.

### Task 1.1: `SlotPosition` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs`
- Create: `tests/domains/playback-hub/SlotPosition.test.mjs`

**Step 1: Write the failing test**

`tests/domains/playback-hub/SlotPosition.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { SlotPosition } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('SlotPosition', () => {
  it('accepts positive integers', () => {
    const p = new SlotPosition(3);
    expect(p.value).toBe(3);
  });
  it('rejects zero, negatives, non-integers', () => {
    expect(() => new SlotPosition(0)).toThrow(ValidationError);
    expect(() => new SlotPosition(-1)).toThrow(ValidationError);
    expect(() => new SlotPosition(1.5)).toThrow(ValidationError);
    expect(() => new SlotPosition('1')).toThrow(ValidationError);
  });
  it('equals by value', () => {
    expect(new SlotPosition(2).equals(new SlotPosition(2))).toBe(true);
    expect(new SlotPosition(2).equals(new SlotPosition(3))).toBe(false);
  });
  it('is frozen', () => {
    const p = new SlotPosition(1);
    expect(Object.isFrozen(p)).toBe(true);
  });
});
```

**Step 2: Run, verify fail**

Run: `npx vitest run tests/domains/playback-hub/SlotPosition.test.mjs`
Expected: FAIL — module not found.

**Step 3: Write the minimal implementation**

`backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs`:
```javascript
import { ValidationError } from '../../core/errors/ValidationError.mjs';

export class SlotPosition {
  #value;
  constructor(value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new ValidationError('SlotPosition must be a positive integer', {
        code: 'INVALID_SLOT_POSITION', field: 'value', value
      });
    }
    this.#value = value;
    Object.freeze(this);
  }
  get value() { return this.#value; }
  equals(other) { return other instanceof SlotPosition && other.value === this.#value; }
}
```

**Step 4: Run, verify pass**

Run: `npx vitest run tests/domains/playback-hub/SlotPosition.test.mjs`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add backend/src/2_domains/playback-hub/value-objects/SlotPosition.mjs tests/domains/playback-hub/SlotPosition.test.mjs
git commit -m "feat(playback-hub): SlotPosition value object"
```

---

### Task 1.2: `SlotColor` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs`
- Create: `tests/domains/playback-hub/SlotColor.test.mjs`

**Step 1: Test**

`tests/domains/playback-hub/SlotColor.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest';
import { SlotColor } from '../../../backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

describe('SlotColor', () => {
  it('accepts non-empty lowercase strings', () => {
    expect(new SlotColor('red').value).toBe('red');
    expect(new SlotColor('white').value).toBe('white');
  });
  it('rejects empty string', () => {
    expect(() => new SlotColor('')).toThrow(ValidationError);
  });
  it('rejects non-string', () => {
    expect(() => new SlotColor(42)).toThrow(ValidationError);
    expect(() => new SlotColor(null)).toThrow(ValidationError);
  });
  it('rejects mixed-case (forces lowercase canonical form)', () => {
    expect(() => new SlotColor('Red')).toThrow(ValidationError);
  });
  it('equals by value', () => {
    expect(new SlotColor('red').equals(new SlotColor('red'))).toBe(true);
    expect(new SlotColor('red').equals(new SlotColor('blue'))).toBe(false);
  });
});
```

**Step 2-4: Run fail → impl → run pass**

`backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs`:
```javascript
import { ValidationError } from '../../core/errors/ValidationError.mjs';

export class SlotColor {
  #value;
  constructor(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('SlotColor must be a non-empty string', {
        code: 'INVALID_SLOT_COLOR', field: 'value', value
      });
    }
    if (value !== value.toLowerCase()) {
      throw new ValidationError('SlotColor must be lowercase', {
        code: 'INVALID_SLOT_COLOR_CASE', field: 'value', value
      });
    }
    this.#value = value;
    Object.freeze(this);
  }
  get value() { return this.#value; }
  equals(other) { return other instanceof SlotColor && other.value === this.#value; }
  toString() { return this.#value; }
}
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/playback-hub/value-objects/SlotColor.mjs tests/domains/playback-hub/SlotColor.test.mjs
git commit -m "feat(playback-hub): SlotColor value object"
```

---

### Task 1.3: `SlotClass` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/SlotClass.mjs`
- Create: `tests/domains/playback-hub/SlotClass.test.mjs`

Mirrors `SlotColor` shape but enum-validated:

```javascript
// SlotClass.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';

const ALLOWED = ['private', 'public'];

export class SlotClass {
  #value;
  constructor(value) {
    if (!ALLOWED.includes(value)) {
      throw new ValidationError(`SlotClass must be one of ${ALLOWED.join('|')}`, {
        code: 'INVALID_SLOT_CLASS', field: 'value', value
      });
    }
    this.#value = value;
    Object.freeze(this);
  }
  get value() { return this.#value; }
  get isPrivate() { return this.#value === 'private'; }
  get isPublic() { return this.#value === 'public'; }
  equals(other) { return other instanceof SlotClass && other.value === this.#value; }
}
```

Test covers: each valid value, an invalid value throws, equals, isPrivate/isPublic helpers. Commit as `feat(playback-hub): SlotClass value object`.

---

### Task 1.4: `DayPattern` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/DayPattern.mjs`
- Create: `tests/domains/playback-hub/DayPattern.test.mjs`

**Step 1: Test**

Covers:
- Accepts `'all' | 'weekdays' | 'weekends'`
- Accepts arrays like `['mon', 'wed']`
- Rejects mixed-case days, unknown days, empty array, non-string-non-array
- `matches(date)` returns true/false correctly: weekdays for Mon-Fri date, weekends for Sat-Sun date, 'all' always true
- `matches()` for `['mon', 'wed', 'fri']` true on Monday, false on Tuesday

**Step 2-4:**

```javascript
// DayPattern.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const STRING_VALUES = ['all', 'weekdays', 'weekends'];

export class DayPattern {
  #value;
  constructor(value) {
    if (typeof value === 'string') {
      if (!STRING_VALUES.includes(value)) {
        throw new ValidationError(`DayPattern string must be one of ${STRING_VALUES.join('|')}`, {
          code: 'INVALID_DAY_PATTERN', value
        });
      }
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new ValidationError('DayPattern array must be non-empty', { code: 'INVALID_DAY_PATTERN', value });
      }
      for (const d of value) {
        if (!DAY_NAMES.includes(d)) {
          throw new ValidationError(`DayPattern array contains unknown day ${d!r}`, { code: 'INVALID_DAY_PATTERN', value });
        }
      }
    } else {
      throw new ValidationError('DayPattern must be string or array', { code: 'INVALID_DAY_PATTERN', value });
    }
    this.#value = Array.isArray(value) ? Object.freeze([...value]) : value;
    Object.freeze(this);
  }
  get value() { return this.#value; }
  matches(date) {
    const dow = DAY_NAMES[date.getDay()]; // 0=sun
    if (this.#value === 'all') return true;
    if (this.#value === 'weekdays') return ['mon','tue','wed','thu','fri'].includes(dow);
    if (this.#value === 'weekends') return ['sat','sun'].includes(dow);
    return this.#value.includes(dow);
  }
}
```

**Step 5: Commit** as `feat(playback-hub): DayPattern value object with matches()`.

---

### Task 1.5: `VolumeBounds` value object (with sparse-preserving toYaml)

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/VolumeBounds.mjs`
- Create: `tests/domains/playback-hub/VolumeBounds.test.mjs`

**Step 1: Test**

Covers:
- `new VolumeBounds({})` → defaults: `{ default: 60, min: 0, max: 100 }` BUT `toYaml()` returns `{}` (preserves sparse)
- `new VolumeBounds({ default: 40, max: 70 })` → `default=40, min=0, max=70`; `toYaml()` returns `{ default: 40, max: 70 }` (sparse-preserving)
- Invariant: `0 ≤ min ≤ default ≤ max ≤ 100`; violations throw `DomainInvariantError`
- `clamp(50)` returns 50; `clamp(200)` returns max; `clamp(-5)` returns min
- Equals by all three values

**Step 2-4:**

```javascript
// VolumeBounds.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../core/errors/DomainInvariantError.mjs';

export class VolumeBounds {
  #default; #min; #max; #userKeys;
  constructor(partial = {}) {
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new ValidationError('VolumeBounds must be an object', { code: 'INVALID_VOLUME_BOUNDS' });
    }
    const userKeys = new Set(Object.keys(partial).filter(k => ['default','min','max'].includes(k)));
    const def = partial.default ?? 60;
    const min = partial.min ?? 0;
    const max = partial.max ?? 100;
    for (const [name, v] of [['default', def], ['min', min], ['max', max]]) {
      if (typeof v !== 'number' || v < 0 || v > 100) {
        throw new ValidationError(`VolumeBounds.${name} must be 0-100`, { code: 'INVALID_VOLUME_BOUNDS', field: name, value: v });
      }
    }
    if (!(min <= def && def <= max)) {
      throw new DomainInvariantError(
        `VolumeBounds invariant violated: min(${min}) ≤ default(${def}) ≤ max(${max})`,
        { code: 'VOLUME_BOUNDS_INVARIANT' }
      );
    }
    this.#default = def; this.#min = min; this.#max = max;
    this.#userKeys = userKeys;
    Object.freeze(this);
  }
  get default() { return this.#default; }
  get min() { return this.#min; }
  get max() { return this.#max; }
  clamp(v) { return Math.max(this.#min, Math.min(this.#max, v)); }
  toYaml() {
    const out = {};
    for (const k of this.#userKeys) out[k] = this[k];
    return out;
  }
  equals(other) {
    return other instanceof VolumeBounds
      && other.default === this.#default && other.min === this.#min && other.max === this.#max;
  }
}
```

**Step 5: Commit** as `feat(playback-hub): VolumeBounds VO with sparse-preserving toYaml`.

---

### Task 1.6: `QueueRef` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs`
- Create: `tests/domains/playback-hub/QueueRef.test.mjs`

**Step 1: Test**

Covers:
- `new QueueRef({ source: 'plex', id: '670208' })` → `.source === 'plex'`, `.id === '670208'`, `.toString() === 'plex:670208'`
- `QueueRef.parse('plex:670208')` static → equivalent
- `QueueRef.parse('670208')` (no colon) → defaults source to `'plex'`
- Empty / non-string id throws
- Equals by value

**Step 2-4:**

```javascript
// QueueRef.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';

export class QueueRef {
  #source; #id;
  constructor({ source, id }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError('QueueRef.id must be a non-empty string', { code: 'INVALID_QUEUE_REF', field: 'id', value: id });
    }
    if (typeof source !== 'string' || source.length === 0) {
      throw new ValidationError('QueueRef.source must be a non-empty string', { code: 'INVALID_QUEUE_REF', field: 'source', value: source });
    }
    this.#source = source; this.#id = id;
    Object.freeze(this);
  }
  get source() { return this.#source; }
  get id() { return this.#id; }
  toString() { return `${this.#source}:${this.#id}`; }
  equals(other) {
    return other instanceof QueueRef && other.source === this.#source && other.id === this.#id;
  }
  static parse(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationError('QueueRef.parse expects non-empty string', { code: 'INVALID_QUEUE_REF', value });
    }
    const idx = value.indexOf(':');
    if (idx < 0) return new QueueRef({ source: 'plex', id: value });
    return new QueueRef({ source: value.slice(0, idx), id: value.slice(idx + 1) });
  }
}
```

**Step 5: Commit** as `feat(playback-hub): QueueRef VO with parse helper`.

---

### Task 1.7: `PlayCommand` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/PlayCommand.mjs`
- Create: `tests/domains/playback-hub/PlayCommand.test.mjs`

**Step 1: Test**

Covers:
- Valid actions: `play | stop | pause | next | prev | volume`
- `action: 'play'` requires `queue: QueueRef` — throw if missing
- `action: 'volume'` requires `volume: number` — throw if missing
- `action: 'stop' | 'pause' | 'next' | 'prev'` accept neither
- Optional `durationMin: number | null`
- `validate()` throws `ValidationError` on impossible combos

```javascript
// PlayCommand.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { QueueRef } from './QueueRef.mjs';

const ACTIONS = ['play', 'stop', 'pause', 'next', 'prev', 'volume'];

export class PlayCommand {
  #action; #queue; #volume; #durationMin;
  constructor({ action, queue = null, volume = null, durationMin = null }) {
    if (!ACTIONS.includes(action)) {
      throw new ValidationError(`PlayCommand.action must be one of ${ACTIONS.join('|')}`, {
        code: 'INVALID_PLAY_COMMAND', field: 'action', value: action
      });
    }
    if (action === 'play' && !(queue instanceof QueueRef)) {
      throw new ValidationError('play action requires a QueueRef', { code: 'INVALID_PLAY_COMMAND', field: 'queue' });
    }
    if (action === 'volume' && (typeof volume !== 'number')) {
      throw new ValidationError('volume action requires numeric volume', { code: 'INVALID_PLAY_COMMAND', field: 'volume' });
    }
    if (volume !== null && (typeof volume !== 'number' || volume < 0 || volume > 100)) {
      throw new ValidationError('volume must be 0-100', { code: 'INVALID_PLAY_COMMAND', field: 'volume', value: volume });
    }
    this.#action = action; this.#queue = queue; this.#volume = volume; this.#durationMin = durationMin;
    Object.freeze(this);
  }
  get action() { return this.#action; }
  get queue() { return this.#queue; }
  get volume() { return this.#volume; }
  get durationMin() { return this.#durationMin; }
}
```

**Step 5: Commit** as `feat(playback-hub): PlayCommand VO with validation`.

---

### Task 1.8: `CommandResult` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/CommandResult.mjs`
- Create: `tests/domains/playback-hub/CommandResult.test.mjs`

The closed-enum reason field is critical. Test covers:
- Valid reasons: `'not-found' | 'unreachable' | 'contention' | 'volume-out-of-bounds' | 'invalid-target'`
- `applied` is an array of `SlotColor` (use raw strings for the VO; the entity layer holds the SlotColor)
- Helper getters: `.allApplied()` boolean, `.allSkipped()` boolean
- Equals by value

```javascript
// CommandResult.mjs
import { ValidationError } from '../../core/errors/ValidationError.mjs';

const REASONS = ['not-found', 'unreachable', 'contention', 'volume-out-of-bounds', 'invalid-target'];

export class CommandResult {
  #applied; #skipped;
  constructor({ applied = [], skipped = [] }) {
    if (!Array.isArray(applied) || !Array.isArray(skipped)) {
      throw new ValidationError('CommandResult.applied/skipped must be arrays', { code: 'INVALID_COMMAND_RESULT' });
    }
    for (const s of skipped) {
      if (!s || typeof s.color !== 'string' || !REASONS.includes(s.reason)) {
        throw new ValidationError(`CommandResult.skipped[].reason must be one of ${REASONS.join('|')}`, {
          code: 'INVALID_COMMAND_RESULT', field: 'skipped', value: s
        });
      }
    }
    this.#applied = Object.freeze([...applied]);
    this.#skipped = Object.freeze(skipped.map(s => Object.freeze({ ...s })));
    Object.freeze(this);
  }
  get applied() { return this.#applied; }
  get skipped() { return this.#skipped; }
  allApplied() { return this.#skipped.length === 0 && this.#applied.length > 0; }
  allSkipped() { return this.#applied.length === 0; }
  static get REASONS() { return [...REASONS]; }
}
```

**Step 5: Commit** as `feat(playback-hub): CommandResult VO with closed-enum reason`.

---

### Task 1.9: `ContinuousSchedule` value object

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/ContinuousSchedule.mjs`
- Create: `tests/domains/playback-hub/ContinuousSchedule.test.mjs`

Test covers:
- `new ContinuousSchedule({ start: '07:00', end: '21:00', queue: QueueRef, shuffle: true })`
- Bad time format rejected (e.g. `'25:00'`, `'07:5'`)
- `activeAt(date)` returns true within window, false outside
- **Wrap-around case:** `start: '21:00', end: '07:00'` should be active at 23:00 AND 03:00, but NOT at 12:00

```javascript
// ContinuousSchedule.mjs (excerpt — key methods)
activeAt(date) {
  const m = date.getHours() * 60 + date.getMinutes();
  const s = this.#startMinutes;
  const e = this.#endMinutes;
  return s < e ? (m >= s && m < e) : (m >= s || m < e);  // wrap-around
}
```

**Step 5: Commit** as `feat(playback-hub): ContinuousSchedule VO with wrap-around activeAt`.

---

### Task 1.10: `SlotStatus` value object (transient snapshot)

**Files:**
- Create: `backend/src/2_domains/playback-hub/value-objects/SlotStatus.mjs`
- Create: `tests/domains/playback-hub/SlotStatus.test.mjs`

Fields: `position, color, bt_connected, paused, now_playing (nullable, has queue), volume, playlist_pos, playlist_count, armed_source (nullable)`. Frozen.

Static factory `SlotStatus.fromHubJson(json)` maps from the hub's JSON wire format. Test the mapping with a known fixture.

**Step 5: Commit** as `feat(playback-hub): SlotStatus VO with hub-JSON mapper`.

---

### Task 1.11: `ScheduledFire` entity

**Files:**
- Create: `backend/src/2_domains/playback-hub/entities/ScheduledFire.mjs`
- Create: `tests/domains/playback-hub/ScheduledFire.test.mjs`

Tests:
- `new ScheduledFire({ id, time, days, target, queue, durationMin })` constructs with valid inputs
- `validate(slotsByColor)` throws `EntityNotFoundError` if `target` not in map
- `validate(slotsByColor)` throws `DomainInvariantError` if `volumeOverride > target.volumeBounds.max`
- `durationMin` can be `null` (= indefinite) or positive integer

```javascript
// ScheduledFire.mjs (key pieces)
import { ValidationError } from '../../core/errors/ValidationError.mjs';
import { DomainInvariantError } from '../../core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '../../core/errors/EntityNotFoundError.mjs';
import { DayPattern } from '../value-objects/DayPattern.mjs';
import { QueueRef } from '../value-objects/QueueRef.mjs';

const TIME_RX = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export class ScheduledFire {
  #id; #time; #days; #target; #queue; #durationMin; #volumeOverride;
  constructor({ id, time, days, target, queue, durationMin = null, volumeOverride = null }) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError('ScheduledFire.id required', { code: 'INVALID_SCHEDULED_FIRE', field: 'id' });
    }
    if (!TIME_RX.test(time)) {
      throw new ValidationError('ScheduledFire.time must be HH:MM', { code: 'INVALID_SCHEDULED_FIRE', field: 'time', value: time });
    }
    if (!(days instanceof DayPattern)) {
      throw new ValidationError('ScheduledFire.days must be a DayPattern', { code: 'INVALID_SCHEDULED_FIRE', field: 'days' });
    }
    if (typeof target !== 'string' || target.length === 0) {
      throw new ValidationError('ScheduledFire.target must be a color string', { code: 'INVALID_SCHEDULED_FIRE', field: 'target' });
    }
    if (!(queue instanceof QueueRef)) {
      throw new ValidationError('ScheduledFire.queue must be a QueueRef', { code: 'INVALID_SCHEDULED_FIRE', field: 'queue' });
    }
    if (durationMin !== null && (!Number.isInteger(durationMin) || durationMin < 1)) {
      throw new ValidationError('ScheduledFire.durationMin must be null or positive integer', { code: 'INVALID_SCHEDULED_FIRE', field: 'durationMin' });
    }
    if (volumeOverride !== null && (typeof volumeOverride !== 'number' || volumeOverride < 0 || volumeOverride > 100)) {
      throw new ValidationError('ScheduledFire.volumeOverride must be null or 0-100', { code: 'INVALID_SCHEDULED_FIRE', field: 'volumeOverride' });
    }
    this.#id = id; this.#time = time; this.#days = days; this.#target = target;
    this.#queue = queue; this.#durationMin = durationMin; this.#volumeOverride = volumeOverride;
    Object.freeze(this);
  }
  get id() { return this.#id; }
  get target() { return this.#target; }
  // ... other getters ...

  validate(slotsByColor) {
    const targetDevice = slotsByColor.get(this.#target);
    if (!targetDevice) {
      throw new EntityNotFoundError('HubDevice', this.#target, { code: 'SCHEDULED_FIRE_TARGET_UNKNOWN' });
    }
    if (this.#volumeOverride !== null && this.#volumeOverride > targetDevice.volumeBounds.max) {
      throw new DomainInvariantError(
        `volumeOverride ${this.#volumeOverride} exceeds target ${this.#target} max ${targetDevice.volumeBounds.max}`,
        { code: 'VOLUME_OVERRIDE_EXCEEDS_BOUNDS' }
      );
    }
  }
}
```

**Step 5: Commit** as `feat(playback-hub): ScheduledFire entity with target/bounds validation`.

---

### Task 1.12: `HubDevice` entity

**Files:**
- Create: `backend/src/2_domains/playback-hub/entities/HubDevice.mjs`
- Create: `tests/domains/playback-hub/HubDevice.test.mjs`

Fields: `position (SlotPosition), color (SlotColor), mac (string, immutable), class (SlotClass), haEntityId (string|null), haTurnOffOnStop (boolean), volumeBounds (VolumeBounds), continuousSchedules (ContinuousSchedule[])`.

Tests:
- Construct with valid inputs
- `class: public` REQUIRES `haEntityId` — otherwise `DomainInvariantError`
- `update({ patch })` enforces same invariant
- `toYaml()` produces YAML-friendly object preserving sparse representation

```javascript
// HubDevice.mjs (key parts)
class HubDevice {
  // ... constructor validation ...
  static create({ position, color, mac, class: cls, haEntityId = null, haTurnOffOnStop = false, volume = null, continuousSchedules = [] }) { ... }
  update(patch) {
    // returns NEW HubDevice with merged fields; re-validates invariants
    const merged = { /* ... */ };
    if (merged.class.isPublic && !merged.haEntityId) {
      throw new DomainInvariantError(`public device ${color.value} requires ha_entity_id`, { code: 'PUBLIC_REQUIRES_HA_ENTITY' });
    }
    return new HubDevice(merged);
  }
  toYaml() { /* sparse-preserving serialization */ }
}
```

**Step 5: Commit** as `feat(playback-hub): HubDevice entity with class/HA invariant`.

---

### Task 1.13: `HubConfig` aggregate root

**Files:**
- Create: `backend/src/2_domains/playback-hub/entities/HubConfig.mjs`
- Create: `tests/domains/playback-hub/HubConfig.test.mjs`

The big one. Tests:
- `new HubConfig({ devices, scheduledFires })` accepts arrays of entities
- `findDevice('red')` returns the device; unknown throws `EntityNotFoundError`
- `findScheduledFire('foo')` ditto
- `patchDevice('red', { volume: { max: 50 } })` returns new aggregate with updated device — original is untouched (immutability)
- `upsertScheduledFire(fire)` — creates if new id, updates if existing; validates `target` exists
- `removeScheduledFire(id)` — throws `EntityNotFoundError` if absent
- `toYaml()` produces full YAML-ready object preserving sparse data
- `daylightStation` block accessor (optional)

```javascript
// HubConfig.mjs (high-level structure)
class HubConfig {
  #devices; #scheduledFires; #daylightStation;
  constructor({ devices, scheduledFires = [], daylightStation = null }) {
    // validate: device colors unique, MACs unique
    // validate: each scheduled fire's target is a known color
  }
  findDevice(color) { /* throws if missing */ }
  findScheduledFire(id) { /* throws if missing */ }
  patchDevice(color, patch) { /* returns new HubConfig */ }
  upsertScheduledFire(fire) { /* returns new HubConfig */ }
  removeScheduledFire(id) { /* returns new HubConfig */ }
  get devices() { return this.#devices; }
  get scheduledFires() { return this.#scheduledFires; }
  toYaml() { /* sparse-preserving */ }
}
```

**Step 5: Commit** as `feat(playback-hub): HubConfig aggregate root`.

---

## Phase 2: Application layer (`3_applications/playback-hub/`)

### Task 2.1: Port interfaces

**Files:**
- Create: `backend/src/3_applications/playback-hub/ports/IPlaybackHubGateway.mjs`
- Create: `backend/src/3_applications/playback-hub/ports/IHubConfigRepository.mjs`

Both are throwing-abstract bases. No tests yet — they're contracts. Commit together:
`feat(playback-hub): port interfaces (IPlaybackHubGateway, IHubConfigRepository)`.

---

### Task 2.2: Fake adapters (for use-case tests)

**Files:**
- Create: `backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs`
- Create: `backend/src/3_applications/playback-hub/test/FakeHubConfigRepository.mjs`

Stateful in-memory fakes that satisfy the port contracts. Used by every use-case test below. The fake gateway has a `setStatusFixture(slots)` and `setNextCommandResult(result)` method. The fake repo has a `setConfig(hubConfig)` method and a `lastSaved` getter to assert what was written.

Commit as `chore(playback-hub): fake adapters for use-case tests`.

---

### Task 2.3: `GetHubStatus` use case

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/GetHubStatus.mjs`
- Create: `tests/applications/playback-hub/GetHubStatus.test.mjs`

**Step 1: Test**

```javascript
import { describe, it, expect } from 'vitest';
import { GetHubStatus } from '.../GetHubStatus.mjs';
import { FakeHubGateway } from '.../test/FakeHubGateway.mjs';
import { SlotStatus } from '.../value-objects/SlotStatus.mjs';

describe('GetHubStatus', () => {
  it('returns slot statuses from the gateway', async () => {
    const gateway = new FakeHubGateway();
    const status = SlotStatus.fromHubJson({ slot: 1, color: 'red', bt_connected: true, /* ... */ });
    gateway.setStatusFixture([status]);
    const useCase = new GetHubStatus({ headsetHubGateway: gateway });
    const result = await useCase.execute();
    expect(result.slots).toEqual([status]);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });
  it('wraps gateway errors', async () => {
    const gateway = new FakeHubGateway();
    gateway.setError(new Error('boom'));
    const useCase = new GetHubStatus({ headsetHubGateway: gateway });
    await expect(useCase.execute()).rejects.toThrow('boom');
  });
});
```

**Step 2-4:** straightforward implementation. **Step 5: Commit** as `feat(playback-hub): GetHubStatus use case`.

---

### Task 2.4: `GetHubConfig` use case

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/GetHubConfig.mjs`
- Create: `tests/applications/playback-hub/GetHubConfig.test.mjs`

Test: `useCase.execute()` returns the `HubConfig` aggregate from the fake repo. Commit as `feat(playback-hub): GetHubConfig use case`.

---

### Task 2.5: `SendHubCommand` use case (with target expansion + volume clamping)

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/SendHubCommand.mjs`
- Create: `tests/applications/playback-hub/SendHubCommand.test.mjs`

**Step 1: Test**

Tests:
- Single-target `play` with valid content → gateway called with that color, returns `CommandResult.applied`
- Group target `'all'` → gateway called with all device colors
- Group target `'all-private'` → only private devices
- Group target `'all-public'` → only public devices
- Comma-list target `'red,blue'` → both
- Volume over target's max → clamped to max before sending
- Gateway returns 409 contention → propagated as `skipped[{reason:'contention'}]` not thrown
- Unknown target → `EntityNotFoundError`

**Step 2-4:** see design doc; uses `HubConfig.devices`, filters, expands, calls gateway.

**Step 5: Commit** as `feat(playback-hub): SendHubCommand with target expansion + volume clamp + 409 handling`.

---

### Task 2.6: `UpdateDeviceConfig` use case

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/UpdateDeviceConfig.mjs`
- Create: `tests/applications/playback-hub/UpdateDeviceConfig.test.mjs`

Tests:
- Patch a slot's `volume.max` → returns updated `HubDevice`; fake repo has saved the new aggregate
- Patch fails domain invariant (public, removing ha_entity_id) → throws, fake repo NOT saved
- Unknown color → `EntityNotFoundError`

**Step 5: Commit** as `feat(playback-hub): UpdateDeviceConfig use case`.

---

### Task 2.7: `SaveScheduledFire` use case

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/SaveScheduledFire.mjs`
- Create: `tests/applications/playback-hub/SaveScheduledFire.test.mjs`

Tests:
- New fire (id not in config) → upserts, fake repo saved
- Existing fire → updates fields
- Target color doesn't exist → `EntityNotFoundError` (from `ScheduledFire.validate`)
- Volume override > target max → `DomainInvariantError`

**Step 5: Commit** as `feat(playback-hub): SaveScheduledFire use case`.

---

### Task 2.8: `DeleteScheduledFire` use case

**Files:**
- Create: `backend/src/3_applications/playback-hub/usecases/DeleteScheduledFire.mjs`
- Create: `tests/applications/playback-hub/DeleteScheduledFire.test.mjs`

Tests:
- Existing id → removed, fake repo saved
- Unknown id → `EntityNotFoundError`

**Step 5: Commit** as `feat(playback-hub): DeleteScheduledFire use case`.

---

### Task 2.9: `HubStatusBroadcaster` service

**Files:**
- Create: `backend/src/3_applications/playback-hub/runtime/HubStatusBroadcaster.mjs`
- Create: `tests/applications/playback-hub/HubStatusBroadcaster.test.mjs`

Tests:
- `start()` then `stop()` cleanly terminates the loop (no test-suite leak)
- On each iteration, publishes a `playback-hub:status` event with snapshot type
- On gateway failure, logs warn + increments `consecutiveFailures`; sleep extends per backoff schedule (mock the timer)
- Serial loop — never two concurrent gateway calls (assertable by counting concurrent calls in the fake)
- `getLastSnapshot()` returns the most-recent published snapshot

The trickiest test: backoff timing. Use a controllable clock (e.g. Vitest's fake timers).

```javascript
// HubStatusBroadcaster.mjs (skeleton)
import { setTimeout as sleep } from 'node:timers/promises';

export class HubStatusBroadcaster {
  constructor({ gateway, eventPublisher, logger, intervalMs = 3000, maxBackoffMs = 30000 }) { /* ... */ }
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#loop = this.#run();
  }
  async stop() {
    this.#running = false;
    await this.#loop;
  }
  async #run() {
    let consecutiveFailures = 0;
    while (this.#running) {
      const startedAt = Date.now();
      try {
        const devices = await this.#gateway.getStatus();
        this.#lastSnapshot = { devices, fetchedAt: new Date() };
        this.#eventPublisher.publish({
          topic: 'playback-hub:status',
          type: 'playback-hub.status.snapshot',
          data: this.#lastSnapshot
        });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        this.#logger.warn?.('playback-hub.broadcaster.fetch_failed', {
          consecutiveFailures, error: err.message
        });
      }
      if (!this.#running) break;
      const elapsed = Date.now() - startedAt;
      const target = consecutiveFailures === 0
        ? this.#intervalMs
        : Math.min(this.#maxBackoffMs, this.#intervalMs * 2 ** Math.min(consecutiveFailures, 4));
      await sleep(Math.max(0, target - elapsed));
    }
  }
  getLastSnapshot() { return this.#lastSnapshot; }
}
```

**Step 5: Commit** as `feat(playback-hub): HubStatusBroadcaster with serial loop + backoff`.

---

### Task 2.10: `PlaybackHubContainer`

**Files:**
- Create: `backend/src/3_applications/playback-hub/PlaybackHubContainer.mjs`
- Create: `tests/applications/playback-hub/PlaybackHubContainer.test.mjs`

DI wiring. Constructor takes `{ config, eventPublisher, logger, http }` (existing system primitives) and exposes:
- `.getHubStatus`, `.getHubConfig`, `.sendHubCommand`, `.updateDeviceConfig`, `.saveScheduledFire`, `.deleteScheduledFire` (use case instances)
- `.broadcaster` (the runtime service)
- `start()` / `stop()` — invoke `broadcaster.start()` / `broadcaster.stop()`

Test: `new PlaybackHubContainer({...mocks...})` instantiates without error; `start()` + `stop()` complete cleanly; each use case is a real instance.

**Step 5: Commit** as `feat(playback-hub): container DI wiring with start/stop`.

---

## Phase 3: Adapters (`1_adapters/`)

### Task 3.1: `HttpPlaybackHubAdapter`

**Files:**
- Create: `backend/src/1_adapters/playback-hub/HttpPlaybackHubAdapter.mjs`
- Create: `tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs`

Use the existing HTTP client (whatever pattern other adapters use — check `HomeAssistantGatewayAdapter` or similar). Test against a **mock HTTP server** (the design's stated test infra — see `tests/fixtures/`):

```javascript
// tests/adapters/playback-hub/HttpPlaybackHubAdapter.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { HttpPlaybackHubAdapter } from '.../HttpPlaybackHubAdapter.mjs';

describe('HttpPlaybackHubAdapter', () => {
  let server, port, adapter;
  beforeEach(async () => {
    server = createServer((req, res) => { /* per-test handler */ });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    adapter = new HttpPlaybackHubAdapter({ baseUrl: `http://127.0.0.1:${port}`, requestTimeoutSec: 2 });
  });
  afterEach(() => server.close());

  it('getStatus maps hub JSON to SlotStatus[]', async () => {
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ slot: 1, color: 'red', bt_connected: true, /* ... */ }]));
    });
    const { slots } = await adapter.getStatus();
    expect(slots[0].color).toBe('red');
  });

  it('sendCommand POSTs to /api/play and returns CommandResult', async () => { /* ... */ });

  it('maps 409 → CommandResult.skipped[{reason:contention}] (no throw)', async () => {
    server.on('request', (req, res) => {
      res.statusCode = 409;
      res.end(JSON.stringify({ targets_skipped: ['red'] }));
    });
    const result = await adapter.sendCommand(playCommand, ['red']);
    expect(result.skipped).toEqual([{ color: 'red', reason: 'contention' }]);
  });

  it('maps 5xx → InfrastructureError', async () => { /* ... */ });

  it('honors requestTimeoutSec', async () => {
    server.on('request', (req, res) => { /* never responds */ });
    await expect(adapter.getStatus()).rejects.toThrow(/timeout/i);
  });
});
```

**Step 5: Commit** as `feat(playback-hub): HttpPlaybackHubAdapter with 409→contention + timeout`.

---

### Task 3.2: `YamlHubConfigDatastore` with in-process mutex

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlHubConfigDatastore.mjs`
- Create: `tests/adapters/persistence/yaml/YamlHubConfigDatastore.test.mjs`

Tests:
- `getConfig()` reads the YAML, returns a `HubConfig` aggregate
- `saveConfig(hubConfig)` writes atomically (staging file + rename)
- Concurrent `saveConfig()` calls are serialized — two parallel updates both land in the YAML (no lost write)
- Invalid YAML (any of the 11 rules) → datastore rejects with the same error class the use case will receive
- The validator-parity fixtures from Task 0.1 are consumed: every `invalid/*.yml` rejected by `saveConfig`; every `valid/*.yml` accepted and produces the matching `.expected.json` after round-trip

```javascript
// YamlHubConfigDatastore.mjs (skeleton, key concurrency bit)
class YamlHubConfigDatastore extends IHubConfigRepository {
  #yamlPath;
  #saveMutex = Promise.resolve();  // serialization chain

  async saveConfig(hubConfig) {
    // Chain onto the existing mutex so concurrent calls run serially.
    const next = this.#saveMutex.then(() => this.#doSave(hubConfig));
    this.#saveMutex = next.catch(() => {});  // catch so one failure doesn't permanently block
    return next;
  }

  async #doSave(hubConfig) {
    const yaml = hubConfig.toYaml();
    this.#validate(yaml);  // mirrors validate_config.py
    const tmpPath = `${this.#yamlPath}.staging.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, yamlDump(yaml));
    await fs.rename(tmpPath, this.#yamlPath);
  }
}
```

The concurrency test:
```javascript
it('serializes concurrent saves — no lost write', async () => {
  const config1 = /* ... with device.red.volume.max=50 ... */;
  const config2 = /* ... with device.red.volume.max=60 ... */;
  await Promise.all([store.saveConfig(config1), store.saveConfig(config2)]);
  const after = await store.getConfig();
  // The LAST save wins, but neither call threw, and the file is well-formed
  expect([50, 60]).toContain(after.findDevice('red').volumeBounds.max);
});
```

**Step 5: Commit** as `feat(playback-hub): YamlHubConfigDatastore with mutex + validator parity`.

---

### Task 3.3: JS-side validator parity test against the shared fixtures

**Files:**
- Create: `tests/playback-hub/test_yaml_datastore_parity.test.mjs`

Mirror of Task 0.2 but for the JS datastore — every `invalid/*.yml` rejected by `YamlHubConfigDatastore`, every `valid/*.yml` produces the matching `*.expected.json`.

**Step 5: Commit** as `test: JS validator parity against shared fixtures`.

---

## Phase 4: Backend API + bootstrap wiring

### Task 4.1: `playbackHub.mjs` router

**Files:**
- Create: `backend/src/4_api/v1/routers/playbackHub.mjs`
- Create: `tests/api/v1/routers/playbackHub.test.mjs`

Thin router — each route resolves a use case from the container, executes with the request body, maps domain errors to HTTP codes. No business logic. Match the existing router style (look at `homeAutomation.mjs` for shape).

7 routes per design:
- `GET /status`
- `GET /config`
- `POST /command`
- `PATCH /devices/:color`
- `POST /scheduled`
- `PUT /scheduled/:id`
- `DELETE /scheduled/:id`

Error mapper middleware:
- `ValidationError` → 400
- `DomainInvariantError` → 422
- `EntityNotFoundError` → 404
- `InfrastructureError` (hub) → 502
- `InfrastructureError` (yaml) → 500

E2E tests use supertest against the express router with a fake container. Each error class gets its own HTTP-code test. `/command` partial-success returns 200 + body; all-fail unreachable returns 502.

**Step 5: Commit** as `feat(playback-hub): /api/v1/playback-hub router with error mapping`.

---

### Task 4.2: Wire container into `bootstrap.mjs`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/4_api/v1/index.mjs` (or wherever routers are mounted)

Add:
```javascript
import { PlaybackHubContainer } from '#apps/playback-hub/PlaybackHubContainer.mjs';
import { createPlaybackHubRouter } from '#api/v1/routers/playbackHub.mjs';

// In bootstrap:
const playbackHubContainer = new PlaybackHubContainer({ config, eventPublisher, logger, http });
playbackHubContainer.start();  // launches HubStatusBroadcaster

// Process shutdown hook:
process.on('SIGTERM', async () => { await playbackHubContainer.stop(); });

// In router mount file:
app.use('/api/v1/playback-hub', createPlaybackHubRouter({ container: playbackHubContainer }));
```

Test: bootstrap-level integration test boots the backend, hits `GET /api/v1/playback-hub/status`, gets a 200 (against a stubbed hub).

**Step 5: Commit** as `chore: wire PlaybackHubContainer into bootstrap`.

---

### Task 4.3: Add `services.yml` config block

**Files:**
- Modify: `data/system/config/services.yml`

```yaml
services:
  homeassistant:
    docker: http://homeassistant:8123
  playback_hub:
    docker: http://kckern-playback-hub:8080
    request_timeout_sec: 2
```

No test — config addition. Smoke verified by Task 4.2 integration test.

**Step 5: Commit** as `config: services.playback_hub for HttpPlaybackHubAdapter`.

---

## Phase 5: HA-call retrofit (carried in this PR)

### Task 5.1: `CallHomeAssistantService` use case

**Files:**
- Create: `backend/src/3_applications/home-automation/usecases/CallHomeAssistantService.mjs`
- Create: `tests/applications/home-automation/CallHomeAssistantService.test.mjs`

Tests:
- `execute({ domain, service, data })` calls `haGateway.callService(domain, service, data)`
- `domain` missing → `ValidationError`
- `service` missing → `ValidationError`
- Gateway not configured → `ApplicationError` (or whatever the existing convention uses)

**Step 5: Commit** as `feat(home-automation): CallHomeAssistantService use case`.

---

### Task 5.2: Refactor `/ha/call` and `/ha/script/:scriptId` to delegate to the use case

**Files:**
- Modify: `backend/src/4_api/v1/routers/homeAutomation.mjs:331-369` (both handlers)
- Modify: `backend/src/4_api/v1/index.mjs` or wherever the router is constructed (to inject the new use case)

After the change, neither handler should reference `haGateway.callService` directly. Existing E2E tests of these endpoints should still pass — they test behavior, not internals.

**Step 5: Commit** as `refactor: HA endpoints delegate to CallHomeAssistantService use case`.

---

## Phase 6: Frontend hooks + utilities

### Task 6.1: `utils/contentId.js`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/utils/contentId.js`
- Create: `frontend/src/modules/Admin/PlaybackHub/utils/contentId.test.js`

```javascript
// contentId.js
export function splitContentId(value) {
  if (!value || typeof value !== 'string') return null;
  const idx = value.indexOf(':');
  if (idx < 0) return { source: 'plex', id: value };
  return { source: value.slice(0, idx), id: value.slice(idx + 1) };
}
export function toContentId(source, id) { return `${source}:${id}`; }
export function plexIdOnly(value) {
  const parts = splitContentId(value);
  return parts?.id ?? null;
}
```

Tests cover round-trip + edge cases. **Commit** as `feat(playback-hub-admin): contentId utils`.

---

### Task 6.2: `utils/titleCache.js`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/utils/titleCache.js`

```javascript
// Module-level shared cache for LabeledContentPicker title resolution.
export const titleCache = new Map();
```

No test (trivial). Commit as `feat(playback-hub-admin): module-level title cache`.

---

### Task 6.3: `useHubStatus.js` (GET + WS overlay with fetchedAt race guard)

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js`
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx`

Test scenarios:
- Mount → fetch resolves → state has 5 devices
- Mount → WS message arrives first → state updates
- Race: fetch resolves AFTER a WS message with newer `fetchedAt` → state stays as WS message (guard works)
- Component unmount during in-flight fetch → no setState-on-unmounted warning

Use vitest + React Testing Library. Mock `fetch` and `wsService.subscribe`.

**Commit** as `feat(playback-hub-admin): useHubStatus with race-guarded GET+WS`.

---

### Task 6.4: `useHubConfig.js`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubConfig.js`
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubConfig.test.jsx`

Simple SWR-style read: returns `{ config, revalidate, loading, error }`. `revalidate()` re-fetches. Tests cover the happy path and 500-error path.

**Commit** as `feat(playback-hub-admin): useHubConfig`.

---

### Task 6.5: `useHubMutations.js`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js`
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`

Accepts `{ revalidate }` at construction. Exposes:
- `sendCommand({ target, action, contentId, volume, durationMin })` — POSTs `/command`; on 200 with `skipped[].reason === 'contention'`, auto-retries ONCE after 500ms
- `updateDevice(color, patch)` — PATCH `/devices/:color`, then `revalidate()`
- `saveFire(fire)` — POST or PUT, then `revalidate()`
- `deleteFire(id)` — DELETE, then `revalidate()`

Tests cover the contention-retry path with mocked fetch + fake timers.

**Commit** as `feat(playback-hub-admin): useHubMutations with contention auto-retry`.

---

## Phase 7: Frontend components (small → big)

### Task 7.1: `LabeledContentPicker`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/LabeledContentPicker.test.jsx`

Use the exact sketch in the design doc (uses `titleCache`, handles both `onChange(id, item)` and `onChange(search)` shapes correctly — no flicker on dropdown pick).

Tests:
- Renders combo box with no label when no `value` set
- With `value="plex:670208"` and no cache → fetches `/api/v1/info/plex/670208`, then renders title
- With `value="plex:670208"` and cached → renders title immediately
- `onChange(id, item)` from dropdown → label updates from `item.title` without refetch
- `onChange(search)` freeform → label cleared, then resolves
- Component unmount during in-flight fetch → no warning (cancel guard)

**Commit** as `feat(playback-hub-admin): LabeledContentPicker wrapper`.

---

### Task 7.2: `DeviceHeader.jsx`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/DeviceHeader.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/DeviceHeader.test.jsx`

Consumes BOTH `slot` (from config) AND `status` (from useHubStatus). Renders: color avatar, name + class badge, BT state, now-playing title, vol gauge "45/75" (current/max).

Tests: rendering with various status states (idle, playing, paused, BT disconnected).

**Commit** as `feat(playback-hub-admin): DeviceHeader component`.

---

### Task 7.3: `TransportRow.jsx`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`

Renders: `[⏮][⏯][⏭]` icon buttons + Mantine `Slider` for volume + `LabeledContentPicker` + "Play Now" button. Wires each button to `mutations.sendCommand(...)`.

Tests: clicking each button fires the right mutation.

**Commit** as `feat(playback-hub-admin): TransportRow component`.

---

### Task 7.4-7.7: Section components

In sequence, each as one task with one test file:

- **Task 7.4:** `VolumeLimitsSection.jsx` — three NumberInputs; save triggers `mutations.updateDevice(color, { volume: {...} })`
- **Task 7.5:** `SchedulesSection.jsx` — list of windows with add/edit/remove; uses `LabeledContentPicker`
- **Task 7.6:** `ScheduledFiresSection.jsx` — list of fires; uses `LabeledContentPicker`; "indefinite" checkbox disables NumberInput
- **Task 7.7:** `HomeAssistantSection.jsx` — text input for `ha_entity_id` + switch for `ha_turn_off_on_stop`

Each gets a single commit: `feat(playback-hub-admin): <name> component`.

---

### Task 7.8: `DeviceCard.jsx`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/DeviceCard.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/DeviceCard.test.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/components/DeviceCard.scss`

Composes `DeviceHeader` + `TransportRow` + Mantine `Accordion` with conditional sections (Schedules only for private, HA only for public).

Test: renders correct sections per class.

**Commit** as `feat(playback-hub-admin): DeviceCard composition`.

---

## Phase 8: Frontend page + nav

### Task 8.1: `PlaybackHubPage.jsx`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.scss`
- Create: `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx`
- Create: `frontend/src/modules/Admin/PlaybackHub/index.js`

Per the design's "Page composition" sketch — uses all three hooks + 5 cards. Test: mount with mocked fetch + WS, asserts cards render in order red, yellow, green, blue, white.

**Commit** as `feat(playback-hub-admin): PlaybackHubPage entry point`.

---

### Task 8.2: Add nav entry + route wiring

**Files:**
- Modify: `frontend/src/modules/Admin/AdminNav.jsx` (add import + section)
- Modify: `frontend/src/modules/Admin/AdminLayout.jsx` or the admin router file (add `/admin/playback-hub` → `PlaybackHubPage`)

```jsx
// AdminNav.jsx — add to existing import:
import { ..., IconBroadcast } from '@tabler/icons-react';

// Add to sections array:
{ label: 'PLAYBACK HUB', items: [
    { label: 'All Devices', icon: IconBroadcast, to: '/admin/playback-hub' }
]},
```

**Commit** as `feat(playback-hub-admin): nav entry + route`.

---

## Phase 9: Integration + smoke

### Task 9.1: Full-stack integration smoke

**Files:**
- Create: `tests/integration/playback-hub-admin-smoke.test.mjs`

Boots the backend with the real container (stubbed gateway pointing at a mock HTTP server simulating the hub). Hits each route, asserts 200 + payload shape. Verifies:
- `GET /status` returns mock-hub data
- `POST /command` action=play target=red content_id=670208 → returns CommandResult, mock hub received POST
- `PATCH /devices/red` updates volume bounds → YAML on disk reflects the change
- `POST /scheduled` creates a fire → next GET /config shows it

**Commit** as `test: playback-hub-admin full-stack smoke`.

---

### Task 9.2: Manual smoke checklist

Add to the design doc's "Open items" section or a new SMOKE.md:

```markdown
## Manual smoke (run once before declaring done)

Pre-requisites: DS dev backend running, real hub at kckern-playback-hub:8080 reachable.

1. Open `/admin/playback-hub` in browser.
   - [ ] 5 cards render
   - [ ] BT-connected slots show "Now: <title>" (LabeledContentPicker resolved)
   - [ ] BT-disconnected slots show "—"

2. Click pause on a playing slot.
   - [ ] Audio pauses on the headset
   - [ ] Card status updates within 3 s (WS broadcaster tick)

3. Pick a new queue in the transport combo, click Play Now.
   - [ ] Audio switches to new queue
   - [ ] Title updates on the card

4. Edit volume.max to 30 on a slot. Save.
   - [ ] YAML on hub (after 60 s) shows new value
   - [ ] Headset's running mpv volume does NOT change (confirms "next start" behavior)
   - [ ] Headset reconnect → new max in effect (vol+ caps at 30)

5. Open a second admin tab. Edit a scheduled fire's time in tab A.
   - [ ] Tab A reflects change
   - [ ] Tab B still shows old value (no cross-tab broadcast — by design)
   - [ ] Tab B revalidate (any other interaction) → updated

6. Stop the hub (`ssh kckern-playback-hub 'systemctl --user stop playback-hub.service'`).
   - [ ] Admin shows stale data
   - [ ] WS broadcaster log shows fetch_failed events; consecutive count climbs
   - [ ] After 30 s, broadcaster is on max backoff
7. Restart the hub.
   - [ ] Admin recovers within 3 s of next successful tick
```

**Commit** as `docs: manual smoke checklist for playback-hub admin`.

---

## Phase 10: Final tidy

### Task 10.1: Verify all tests pass + lint clean

Run: `npm test` (backend + frontend). Expected: all green.
Run: `npm run lint` (if configured). Expected: clean.

### Task 10.2: Update CLAUDE.md / memory with the new bounded context

Add a note pointing at the new files for future agents. Quick paragraph in MEMORY.md or as a new reference memory.

**Commit** as `docs: memory note for playback-hub admin bounded context`.

---

## Total task count

- Phase 0: 2 tasks
- Phase 1: 13 tasks (one per VO/entity)
- Phase 2: 10 tasks (ports + 6 use cases + broadcaster + container + fake adapters)
- Phase 3: 3 tasks
- Phase 4: 3 tasks
- Phase 5: 2 tasks
- Phase 6: 5 tasks
- Phase 7: 8 tasks
- Phase 8: 2 tasks
- Phase 9: 2 tasks
- Phase 10: 2 tasks

**= ~52 commit-able tasks**, each a discrete TDD cycle (test → fail → impl → pass → commit). Average task time: 10-20 min for domain VOs, 30-60 min for use cases and components, 60+ min for the broadcaster + datastore + integration smoke.

**Estimated total: ~25-35 hours of focused work** for one engineer, plus review time.

---

## Cross-cutting reminders

- **TDD: always write test first** — even for trivial VOs. The tests document the invariants.
- **One commit per task** — small, reviewable, revertable.
- **`set -euo pipefail` equivalent in JS:** every async fn either returns a value or throws; no swallowed promise rejections.
- **Domain layer is pure:** no `console.log`, no `fetch`, no `Date.now()` without injection.
- **Use the existing logging framework** per `CLAUDE.md` — `getChildLogger({ component: 'PlaybackHubPage' })`, never `console.*` in new frontend code.
- **No `.env` mutations** — config flows through `services.yml`.
- **Frontend tests use `@testing-library/react`** and the existing vitest setup; consult `tests/frontend/setup.mjs` for the project's mocking patterns.
- **Backend tests use vitest** with the existing `tests/setup.mjs` patterns.
- **Validation parity test** (Phase 0) MUST pass before any other backend work begins. It's the contract.
