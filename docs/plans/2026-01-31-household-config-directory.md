# Household Config Directory Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate household configuration into a `config/` subdirectory, including moving `household.yml`, `integrations.yml`, and merging device configs (`apps/devices/config.yml` + `apps/piano/config.yml`) into `config/devices.yml`.

**Architecture:** Update path references in configLoader (the source of truth for file locations), add devices loading, update ConfigService, and update frontend consumers. Delete obsolete `apps/devices/` and `apps/piano/` directories.

**Tech Stack:** Node.js (ES modules), YAML configs, React, Jest tests

---

## Task 1: Update configLoader.mjs Paths ✅ DONE

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs:135,198`

Commit: `2e6961be` - paths updated to use `config/` subdirectory.

---

## Task 2: Update configValidator.mjs Path

**Files:**
- Modify: `backend/src/0_system/config/configValidator.mjs:56`

**Step 1: Update checkedPaths reference**

Change line 56:

```javascript
// FROM:
checkedPaths.push(`${dataDir}/${folderName}/household.yml`);

// TO:
checkedPaths.push(`${dataDir}/${folderName}/config/household.yml`);
```

**Step 2: Commit**

```bash
git add backend/src/0_system/config/configValidator.mjs
git commit -m "refactor(config): update validator path for household config"
```

---

## Task 3: Add devices.yml loading to configLoader

**Files:**
- Modify: `backend/src/0_system/config/configLoader.mjs`

**Step 1: Add loadHouseholdDevices function**

After `loadHouseholdIntegrations` (around line 200), add:

```javascript
/**
 * Load devices config for a household.
 */
function loadHouseholdDevices(dataDir, folderName) {
  const devicesPath = path.join(dataDir, folderName, 'config', 'devices.yml');
  return readYaml(devicesPath) ?? {};
}
```

**Step 2: Add devices to household object**

In `loadAllHouseholds`, add devices loading (around line 142):

```javascript
households[householdId] = {
  ...config,
  _folderName: dir,
  integrations: loadHouseholdIntegrations(dataDir, dir),
  devices: loadHouseholdDevices(dataDir, dir),  // ADD THIS
  apps: loadHouseholdApps(dataDir, dir),
};
```

**Step 3: Commit**

```bash
git add backend/src/0_system/config/configLoader.mjs
git commit -m "feat(config): add devices.yml loading to configLoader"
```

---

## Task 4: Add getHouseholdDevices to ConfigService

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs`

**Step 1: Add getHouseholdDevices method**

After `getHouseholdIntegrations` method (around line 150), add:

```javascript
/**
 * Get devices config for a household
 * @param {string|null} householdId - Household ID, defaults to default household
 * @returns {object}
 */
getHouseholdDevices(householdId = null) {
  const hid = householdId ?? this.getDefaultHouseholdId();
  return this.#config.households?.[hid]?.devices ?? {};
}

/**
 * Get a specific device config
 * @param {string} deviceId - Device ID (e.g., 'office-tv', 'piano')
 * @param {string|null} householdId - Household ID, defaults to default household
 * @returns {object|null}
 */
getDeviceConfig(deviceId, householdId = null) {
  const devices = this.getHouseholdDevices(householdId);
  return devices?.devices?.[deviceId] ?? null;
}
```

**Step 2: Commit**

```bash
git add backend/src/0_system/config/ConfigService.mjs
git commit -m "feat(config): add getHouseholdDevices and getDeviceConfig methods"
```

---

## Task 5: Update backend device config consumer

**Files:**
- Modify: `backend/src/app.mjs:715`

**Step 1: Update devices config access**

Find line 715 and change:

```javascript
// FROM:
const devicesConfig = configService.getHouseholdAppConfig(householdId, 'devices') || {};

// TO:
const devicesConfig = configService.getHouseholdDevices(householdId);
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor(app): use getHouseholdDevices for device config"
```

---

## Task 6: Update PianoVisualizer to read from device config

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx:44`

**Step 1: Update config fetch**

Change the config loading (around line 44):

```javascript
// FROM:
const config = await DaylightAPI('data/household/apps/piano/config');

// TO:
const devicesConfig = await DaylightAPI('config/devices');
const pianoConfig = devicesConfig?.devices?.['office-tv']?.modules?.['piano-visualizer'] ?? {};
// Note: In a real implementation, we'd detect which device we're running on
// For now, hardcode office-tv as that's where the visualizer runs
```

**Step 2: Update script references**

Update the script access to use new structure:

```javascript
// FROM:
const script = config?.on_open?.ha_script;

// TO:
const script = pianoConfig?.on_open;
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoVisualizer.jsx
git commit -m "refactor(piano): read config from devices.yml"
```

---

## Task 7: Update test generator

**Files:**
- Modify: `tests/_infrastructure/generators/setup-household-demo.mjs`

**Step 1: Create config subdirectory and update output paths**

Update the file generation section:

```javascript
const configDir = path.join(OUTPUT_DIR, 'config');
fs.mkdirSync(configDir, { recursive: true });

writeYaml(path.join(configDir, 'household.yml'), generateHouseholdConfig());
console.log('  ✓ config/household.yml');

writeYaml(path.join(configDir, 'integrations.yml'), generateIntegrationsConfig());
console.log('  ✓ config/integrations.yml');

writeYaml(path.join(configDir, 'devices.yml'), generateDevicesConfig());
console.log('  ✓ config/devices.yml');
```

**Step 2: Add generateDevicesConfig function**

```javascript
function generateDevicesConfig() {
  return {
    devices: {
      'demo-tv': {
        type: 'demo-device',
        device_control: {
          displays: {
            main: {
              provider: 'mock'
            }
          }
        }
      }
    }
  };
}
```

**Step 3: Commit**

```bash
git add tests/_infrastructure/generators/setup-household-demo.mjs
git commit -m "refactor(tests): update demo generator for config/ subdir with devices"
```

---

## Task 8: Update test harness

**Files:**
- Modify: `tests/_infrastructure/harnesses/integrated.harness.mjs:13`

**Step 1: Update path check**

```javascript
// FROM:
if (!fs.existsSync(HOUSEHOLD_DEMO) || !fs.existsSync(path.join(HOUSEHOLD_DEMO, 'household.yml'))) {

// TO:
if (!fs.existsSync(HOUSEHOLD_DEMO) || !fs.existsSync(path.join(HOUSEHOLD_DEMO, 'config', 'household.yml'))) {
```

**Step 2: Commit**

```bash
git add tests/_infrastructure/harnesses/integrated.harness.mjs
git commit -m "refactor(tests): update harness path check for config/ subdir"
```

---

## Task 9: Create merged devices.yml and move data files

**Files:**
- Create: `data/household/config/devices.yml` (merged content)
- Move: `data/household/household.yml` → `data/household/config/household.yml`
- Move: `data/household/integrations.yml` → `data/household/config/integrations.yml`
- Delete: `data/household/apps/devices/` directory
- Delete: `data/household/apps/piano/` directory

**Step 1: Create config directory**

```bash
mkdir -p /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config
```

**Step 2: Move existing config files**

```bash
mv /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/household.yml \
   /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/
mv /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/integrations.yml \
   /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/
```

**Step 3: Create merged devices.yml**

Create `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/devices.yml`:

```yaml
# =============================================================================
# Device Registry Configuration
# =============================================================================

devices:
  # ---------------------------------------------------------------------------
  # Living Room Shield TV
  # ---------------------------------------------------------------------------
  livingroom-tv:
    type: shield-tv
    device_control:
      displays:
        tv:
          provider: homeassistant
          on_script: script.living_room_tv_on
          off_script: script.living_room_tv_off
          volume_script: script.living_room_tv_volume
          state_sensor: sensor.living_room_tv_state
    content_control:
      provider: fully-kiosk
      host: 10.0.0.11
      port: 2323
      auth_ref: fullykiosk

  # ---------------------------------------------------------------------------
  # Office PC
  # ---------------------------------------------------------------------------
  office-tv:
    type: linux-pc
    device_control:
      displays:
        tv:
          provider: homeassistant
          on_script: script.office_tv_on
          off_script: script.office_tv_off
        monitor:
          provider: homeassistant
          on_script: script.office_monitor_on
          off_script: script.office_monitor_off
    os_control:
      provider: ssh
      host: 172.17.0.1
      user: kckern
      port: 22
      commands:
        volume: "amixer set Master {level}%"
        mute: "amixer set Master mute"
        unmute: "amixer set Master unmute"
        audio_device: "pactl set-default-sink {device}"
    content_control:
      provider: websocket
      topic: office
    # Module hooks - actions when modules activate on this device
    modules:
      piano-visualizer:
        on_open: script.office_tv_hdmi_3
        # on_close: script.office_tv_hdmi_1

  # ---------------------------------------------------------------------------
  # Piano (MIDI keyboard)
  # ---------------------------------------------------------------------------
  piano:
    type: midi-keyboard
    extension: _extensions/piano
```

**Step 4: Delete old app directories**

```bash
rm -rf /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/apps/devices
rm -rf /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/apps/piano
```

**Step 5: Verify**

```bash
ls -la /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/
```

Expected: `household.yml`, `integrations.yml`, `devices.yml`

---

## Task 10: Regenerate test demo data

**Step 1: Regenerate household-demo with new structure**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
node tests/_infrastructure/generators/setup-household-demo.mjs
```

Expected output should show config files in `config/` subdirectory.

**Step 2: Verify demo structure**

```bash
ls -la tests/_infrastructure/household-demo/config/
```

---

## Task 11: Run tests to verify

**Step 1: Run config-related unit tests**

```bash
npm test -- --grep "config" --passWithNoTests
```

**Step 2: Run integrated tests**

```bash
npm test -- tests/_infrastructure/harnesses/
```

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any test issues from config migration"
```

---

## Summary

| Before | After |
|--------|-------|
| `household/household.yml` | `household/config/household.yml` |
| `household/integrations.yml` | `household/config/integrations.yml` |
| `household/apps/devices/config.yml` | `household/config/devices.yml` |
| `household/apps/piano/config.yml` | Merged into `devices.yml` under `office-tv.modules.piano-visualizer` |

**Code changes:**
- `configLoader.mjs` - paths + devices loading
- `configValidator.mjs` - path update
- `ConfigService.mjs` - new device methods
- `app.mjs` - use new device methods
- `PianoVisualizer.jsx` - read from device config
- Test generator + harness updates

**Data changes:**
- 3 config files in `config/` subdirectory
- Delete `apps/devices/` and `apps/piano/` directories
