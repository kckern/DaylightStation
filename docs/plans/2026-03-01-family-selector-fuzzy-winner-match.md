# Family Selector Fuzzy Winner Match

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow `family-selector/<name>` to match by user id, group_label, or name — not just exact id.

**Architecture:** The `selectWinner` function in `FamilySelector.jsx` currently does a strict `m.id === riggedWinner` match. Since members are built from the gratitude bootstrap API with `id` (e.g., `elizabeth`) and `name` (from `group_label`, e.g., `Mom`), a config value like `family-selector/mom` silently falls through to random selection. Fix by adding case-insensitive fallback matching against `name`. Also revert the config workaround so it uses the human-friendly `mom` value.

**Tech Stack:** React (JSX), Vitest or manual browser testing

---

### Task 1: Fix winner matching in FamilySelector

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:260-273`

**Step 1: Update `selectWinner` to match by id OR name (case-insensitive)**

Replace the `selectWinner` callback (lines 260-273) with:

```jsx
const selectWinner = useCallback(() => {
    let index, member;
    if (riggedWinner) {
      const needle = riggedWinner.toLowerCase();
      index = activeMembers.findIndex(m =>
        m.id === riggedWinner || m.name.toLowerCase() === needle
      );
      if (index !== -1) {
        member = activeMembers[index];
      }
    }
    if (!member) {
      index = Math.floor(Math.random() * activeMembers.length);
      member = activeMembers[index];
    }
    return { index, member };
  }, [activeMembers, riggedWinner]);
```

**Step 2: Verify in browser**

Open the FHE menu, tap Spotlight. The wheel should always land on Mom (Elizabeth).

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "fix(family-selector): match rigged winner by name or group_label, not just id"
```

---

### Task 2: Revert config workaround

**Files:**
- Modify: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/household/config/lists/menus/fhe.yml:9`

**Step 1: Change `elizabeth` back to `mom`**

```yaml
    input: app:family-selector/mom
```

This is the human-friendly value that config authors would naturally write. The code fix from Task 1 makes it work.

**Step 2: Restart Docker container and verify API**

```bash
docker restart daylight-station
sleep 15
curl -s https://daylightlocal.kckern.net/api/v1/list/menu/fhe/recent_on_top | jq '.items[] | select(.label == "Spotlight") | {label, id}'
```

Expected: `"id": "app:family-selector/mom"`
