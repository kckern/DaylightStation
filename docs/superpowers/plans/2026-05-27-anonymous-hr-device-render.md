# Anonymous HR Device Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HR devices that broadcast over ANT+ but have no `fitness.yml` mapping and no guest-assignment ledger entry appear in the fitness UI as anonymous Pikachu cards labelled `#<deviceId>`, so the existing assignment UX (`FitnessSidebarMenu` in `mode='guest'`) can be used to tag them.

**Architecture:** Single-file change at the SSOT for participant roster construction. `ParticipantRoster._buildRosterEntry` currently returns `null` when no participantName resolves, dropping every anonymous device before it reaches `SidebarFooter` / `FitnessUsers`. The fix synthesizes a `#<deviceId>` name and a `device:<deviceId>` profile ID for anonymous devices and removes the early return. Downstream components (`SidebarFooter.jsx:387-389`, `FitnessUsers.jsx:896-907`) already fall through to the Pikachu fallback image when `profileId` doesn't resolve to a real avatar file — no UI changes needed.

**Tech Stack:** React 18 frontend, vitest for colocated frontend tests (`*.test.js` next to source, import from `'vitest'`), Playwright for live verification, `npx vitest run <path>` to execute a single test file.

**Out of scope:**
- Governance behavior for anonymous devices (whether they count toward `active: all`) — this is documented as a known tradeoff in `docs/_wip/audits/2026-05-26-guest-mode-ux-audit.md` and is a separate decision.
- Session-start gating (whether random HR>0 broadcasts should auto-start a session) — separate concern, separate plan.
- Documentation rewrite of `docs/reference/fitness/unknown-hr-monitors.md` — that doc already describes the desired behavior; once code matches doc, no rewrite needed.

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Modify | Synthesize identifiers for anonymous devices in `_buildRosterEntry`; update `getRoster()` comments to reflect that anonymous entries are now emitted, not dropped |
| `frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js` | Create | Two-test suite covering (a) anonymous device produces an entry; (b) once tagged via the ledger, the same device's entry reflects the assigned name |

---

## Task 1: Failing test — anonymous device produces a roster entry

**Files:**
- Create: `frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js`

- [ ] **Step 1: Write the failing test**

Create the file with this exact content:

```javascript
/**
 * ParticipantRoster — anonymous HR devices must render.
 *
 * When an ANT+ HR strap broadcasts a deviceId that is NOT in
 * fitness.yml `devices.heart_rate` AND has no guest-assignment ledger
 * entry, the roster currently drops the device silently. That makes the
 * existing `FitnessSidebarMenu` assignment UX unreachable — there is no
 * card to tap. These tests guard the contract that anonymous devices
 * appear with a synthetic `#<deviceId>` name + `device:<deviceId>` id,
 * matching the behavior described in
 * docs/reference/fitness/unknown-hr-monitors.md.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { ParticipantRoster } from './ParticipantRoster.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';

const buildRoster = () => {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager });
  return { roster, deviceManager, userManager };
};

describe('ParticipantRoster — anonymous HR device rendering', () => {
  it('emits a roster entry for an HR device with no mapped user and no ledger assignment', () => {
    const { roster, deviceManager } = buildRoster();

    // Simulate the WS frame path: registerDevice with an HR profile and
    // an unrecognized deviceId.
    deviceManager.registerDevice({
      id: '10366',
      deviceId: '10366',
      type: 'heart_rate',
      profile: 'HR',
      heartRate: 72,
      lastSeen: Date.now()
    });

    const result = roster.getRoster();

    expect(result).toHaveLength(1);
    const [entry] = result;
    expect(entry.name).toBe('#10366');
    expect(entry.hrDeviceId).toBe('10366');
    expect(entry.hrDeviceIds).toEqual(['10366']);
    expect(entry.profileId).toBe('device:10366');
    expect(entry.id).toBe('device:10366');
    expect(entry.isGuest).toBe(true);
    expect(entry.avatarUrl).toBeNull();
  });

  it('preserves the synthetic identifiers for two simultaneous anonymous devices (no collision)', () => {
    const { roster, deviceManager } = buildRoster();
    deviceManager.registerDevice({ id: '10366', type: 'heart_rate', heartRate: 70, lastSeen: Date.now() });
    deviceManager.registerDevice({ id: '11521', type: 'heart_rate', heartRate: 80, lastSeen: Date.now() });

    const result = roster.getRoster();
    expect(result).toHaveLength(2);
    const ids = result.map(e => e.id).sort();
    expect(ids).toEqual(['device:10366', 'device:11521']);
    const names = result.map(e => e.name).sort();
    expect(names).toEqual(['#10366', '#11521']);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `npx vitest run frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js`

Expected: both `it(...)` cases FAIL with `expected [] to have a length of 1` (or `2`). The current code drops the anonymous entries, so `result` is `[]`.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js
git commit -m "test(fitness): guard anonymous HR devices appear in roster"
```

---

## Task 2: Fix — synthesize name + id for anonymous devices

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (the `_buildRosterEntry` method around lines 408-431, and the comments in `getRoster` around lines 137-141 and 178-180)

- [ ] **Step 1: Replace the participant-name + early-return block in `_buildRosterEntry`**

In `frontend/src/hooks/fitness/ParticipantRoster.js`, find this block (around lines 419-431):

```javascript
    // Resolve participant name from guest assignment or user mapping
    const guestEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
    const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
    const mappedUser = this._userManager.resolveUserForDevice(deviceId);
    const participantName = ledgerName || mappedUser?.name;

    if (!participantName) return null;

    // Use the actual user ID - must be explicitly set
    const userId = mappedUser?.id || guestEntry?.occupantId || guestEntry?.metadata?.profileId;
    if (!userId) {
      getLogger().warn('participant.roster.missing_user_id', { participantName });
    }
```

Replace it with:

```javascript
    // Resolve participant name + id. Anonymous devices (no user mapping
    // and no guest-assignment ledger entry) get synthetic identifiers so
    // they render as cards the user can tap to tag via FitnessSidebarMenu.
    // Without this, unrecognized ANT+ HR straps broadcast silently — see
    // docs/reference/fitness/unknown-hr-monitors.md.
    const guestEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
    const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
    const mappedUser = this._userManager.resolveUserForDevice(deviceId);
    const participantName = ledgerName || mappedUser?.name || `#${deviceId}`;

    const userId = mappedUser?.id
      || guestEntry?.occupantId
      || guestEntry?.metadata?.profileId
      || `device:${deviceId}`;
```

The early-return on `!participantName` is removed (the new fallback always produces a name). The `missing_user_id` warn is removed (userId is always set after the synthesis).

- [ ] **Step 2: Update the stale `getRoster` comments**

In the same file, find this block (around lines 137-141):

```javascript
      } else {
        // Truly anonymous — no user, no ledger. Preserve current drop-anon
        // behavior (_buildRosterEntry returns null when no participantName).
        anonymousDevices.push(device);
      }
```

Replace with:

```javascript
      } else {
        // Truly anonymous — no user, no ledger. Rendered as a Pikachu
        // card with name `#<deviceId>` so the user can tap to assign
        // via FitnessSidebarMenu. See _buildRosterEntry synthesis path.
        anonymousDevices.push(device);
      }
```

Then find this block (around lines 178-181):

```javascript
    // Emit truly-anonymous device entries unchanged (will be dropped inside
    // _buildRosterEntry because no participantName resolves — preserves the
    // previous contract explicitly).
    for (const device of anonymousDevices) {
```

Replace with:

```javascript
    // Emit truly-anonymous device entries with synthesized name + id from
    // _buildRosterEntry, so the assignment UX is reachable.
    for (const device of anonymousDevices) {
```

- [ ] **Step 3: Run the new test — confirm it passes**

Run: `npx vitest run frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js`

Expected: both cases PASS. If the second case fails on entry count (expecting 2, got 1), the most likely cause is the `getRoster` iteration over `devicesByUserId` colliding with anonymous keys — re-read lines 121-142 and confirm `anonymousDevices` (a plain array) is separate from `devicesByUserId` (a Map).

- [ ] **Step 4: Run the existing ParticipantRoster + FitnessSession test suites — confirm no regressions**

Run: `npx vitest run frontend/src/hooks/fitness/`

Expected: all colocated fitness tests pass. Pay attention to any test that asserts `roster.length === 0` for an unmapped-device scenario — those are now incorrect and the test needs updating to assert the synthesized identity instead. If a test fails, read it and decide:
- If the test was guarding the old drop-anon contract → update the test to assert the new contract (synthesized `#<deviceId>` entry present).
- If the test fails for an unrelated reason → that's a real regression in the fix.

Report any test files that need updating before continuing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.js
git commit -m "fix(fitness): render anonymous HR devices as #<deviceId> cards

ParticipantRoster._buildRosterEntry returned null for any device without
a mapped user OR a guest-assignment ledger entry, silently dropping
unrecognized ANT+ HR straps before they reached SidebarFooter and
FitnessUsers. This made the existing FitnessSidebarMenu assignment UX
unreachable for visitors with their own straps.

Synthesize a '#<deviceId>' name and 'device:<deviceId>' profile id when
neither lookup resolves, matching the behavior documented in
docs/reference/fitness/unknown-hr-monitors.md and the audit in
docs/_wip/audits/2026-05-26-guest-mode-ux-audit.md. The downstream
avatar fallback (user.jpg / Pikachu) already handles unknown profileIds."
```

---

## Task 3: Failing test — assignment swaps the synthetic name

**Files:**
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js` (append a third test case)

- [ ] **Step 1: Append the third test case**

Inside the existing `describe('ParticipantRoster — anonymous HR device rendering', ...)` block in the test file, add this test before the closing `});`:

```javascript
  it('swaps the synthetic name once the device is tagged via assignGuest', () => {
    const { roster, deviceManager, userManager } = buildRoster();

    deviceManager.registerDevice({
      id: '10366',
      type: 'heart_rate',
      heartRate: 72,
      lastSeen: Date.now()
    });

    // Pre-assignment: anonymous identity
    const before = roster.getRoster();
    expect(before).toHaveLength(1);
    expect(before[0].name).toBe('#10366');

    // Tag the device — mirrors what FitnessSidebarMenu.handleAssignGuest does
    // with the generic 'Guest' choice (W2 device-keyed alias).
    userManager.assignGuest('10366', 'Guest', {
      profileId: 'guest_10366',
      occupantType: 'guest'
    });

    // Post-assignment: ledger entry wins, synthetic name is gone
    const after = roster.getRoster();
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Guest');
    expect(after[0].id).toBe('guest_10366');
    expect(after[0].isGuest).toBe(true);
  });
```

- [ ] **Step 2: Run the updated test file — confirm the new case passes**

Run: `npx vitest run frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js`

Expected: all three cases PASS. If the third case fails because the post-assignment `name` is still `#10366`, it means `assignmentLedger.get('10366')` is not returning an entry — re-verify `assignGuest` was called with the device id as a string and that `userManager.assignmentLedger` is wired up (this is the default in `new UserManager()`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/ParticipantRoster.anonymousDevice.test.js
git commit -m "test(fitness): cover anonymous→tagged identity swap on assignment"
```

---

## Task 4: Live verification with Playwright

**Files:**
- No new files — uses a throwaway script

- [ ] **Step 1: Confirm the dev/prod app is reachable**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3111/fitness`

Expected: `200`. If not 200, the production Docker container is down — start with `sudo deploy-daylight` (this host is kckern-server, deploy-at-will is enabled per CLAUDE.local.md).

**If you made the fix in dev only (vite hot-reload), 3111 already has it via dev-server. If you need to deploy to confirm in prod:**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 2: Write the verification script**

The script must live inside the repo so `import 'playwright'` resolves. Write to `tmp-verify-anonymous-device.mjs` at the project root:

```javascript
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';
const { chromium } = pkg;

const url = 'http://localhost:3111/fitness';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// Give the WS time to deliver several frames for device 10366 (the live
// garage strap, broadcasting at ~4Hz). One frame is enough to register
// the device; a few seconds settles the React render.
await page.waitForTimeout(8000);

await page.screenshot({ path: '/tmp/anon-fitness-full.png' });
await page.screenshot({ path: '/tmp/anon-fitness-bottomleft.png', clip: { x: 0, y: 600, width: 600, height: 480 } });

// Look for the synthetic name in the DOM.
const matches = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach(el => {
    const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
      ? el.textContent.trim() : '';
    if (text === '#10366' || text === '10366') {
      out.push({ tag: el.tagName, cls: el.className, text });
    }
  });
  return out;
});
console.log('DOM matches for 10366:', JSON.stringify(matches, null, 2));

const roster = await page.evaluate(() => {
  const s = window.__fitnessSession;
  if (!s) return null;
  return {
    stats: s.getMemoryStats?.() || null,
    rosterLen: s.roster?.length ?? null,
    rosterIds: (s.roster || []).map(e => ({ id: e.id, name: e.name }))
  };
});
console.log('Session roster:', JSON.stringify(roster, null, 2));

await browser.close();
```

- [ ] **Step 3: Run the verification script**

Run: `node tmp-verify-anonymous-device.mjs`

Expected output:
- `DOM matches for 10366:` should be a non-empty array — at minimum the `CircularUserAvatar` ariaLabel or the `hrOwnerMap` lookup will produce `10366` or `#10366` in the rendered DOM.
- `Session roster:` should show `rosterLen >= 1` and at least one entry where `id === 'device:10366'` and `name === '#10366'`.

If `rosterLen` is still 0, but `getMemoryStats().deviceCount` is 1, the fix did not land in the running app — confirm dev server picked up the change (check the `dev.log`) or that the production rebuild completed.

- [ ] **Step 4: Visually inspect the screenshots**

Open `/tmp/anon-fitness-bottomleft.png` via the Read tool. Expected: a small HR-style card visible in the bottom-left of the sidebar (where the gear-only state used to be), with the Pikachu avatar and a `#10366` label or aria-label.

- [ ] **Step 5: Clean up the script**

Run: `rm tmp-verify-anonymous-device.mjs`

This script is throwaway diagnostic only — do not commit it.

---

## Task 5: Confirm the assignment UX still works end-to-end

**Files:**
- No new files — manual verification using the same playwright script as Task 4

- [ ] **Step 1: Manually verify the assignment UX from the live app**

This is a human-driven check, but Claude should narrate what to expect:

1. Open `http://localhost:3111/fitness/users` in a browser on the household TV (or kckern-server's browser).
2. Locate the `#10366` Pikachu card in the participants sidebar.
3. Tap the card. `FitnessSidebarMenu` should open in `mode='guest'` with the header `#10366` (per `FitnessSidebarMenu.jsx:62` — `monitorLabel = deviceIdStr ? \`#${deviceIdStr}\` : 'Unknown'`).
4. Pick any candidate (e.g., the generic "Guest" button on the Friends/Family tab).
5. The card should immediately switch to the assigned identity (per `e1fba8088` device-keyed alias: profileId becomes `guest_10366`).

- [ ] **Step 2: Document confirmation**

Reply in the conversation with one of:
- ✅ "Assignment UX works end-to-end against live anonymous device 10366."
- ❌ Specific failure point + screenshot + relevant log line from `dev.log` or container logs.

No commit for this task — purely a verification gate.

---

## Self-Review Checklist (for plan author, not for execution)

- ✅ **Spec coverage:** Goal is "anonymous devices appear so existing assignment UX is reachable." Tasks 1+2 produce the entry; Task 3 covers the swap path; Tasks 4+5 verify live + UX. Covered.
- ✅ **No placeholders:** Every code block contains the real diff or test. No "TBD" / "add error handling".
- ✅ **Type consistency:** `participantName`, `userId`, `entry.id`, `entry.profileId`, `entry.name`, `hrDeviceId` — all match between fix code and test assertions.
- ✅ **Filed under** `docs/superpowers/plans/2026-05-27-anonymous-hr-device-render.md` per the project convention.

---

## Notes for Future Decisions (not part of this plan)

These were identified during debugging but are intentionally not in scope:

1. **Governance impact:** Once anonymous devices render, they will also count toward `governance.base_requirement: [{active: all}]` evaluation. This is the documented "Pikachu cards count toward governance" tradeoff in `docs/reference/fitness/unknown-hr-monitors.md` line 215 and audit gap G19. If this becomes a UX problem in practice, the resolution is either (a) `Remove User` from the sidebar menu to suppress until the next reading, or (b) extend `GovernanceEngine` with an `excludeAnonymous` policy option. Decide separately.

2. **Session-start gating:** There is no "known user required" gate on session start — any HR>0 broadcast can trigger a session. A random cyclist passing by with a working strap would still start a session even before this fix. If privacy against passersby is a goal, gate `_isValidPreSessionSample` on `mappedUser || ledgerEntry || guestSlot`. Separate plan.

3. **Historical participants set:** A `device:<deviceId>` id added to `_historicalParticipants` before the device is tagged, then a `guest_<deviceId>` id added after, results in both being present in the chart legend. The chart will show an empty series for `device:<deviceId>` if it was untagged the whole time. Probably harmless; revisit if the chart legend gets cluttered.
