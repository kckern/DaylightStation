# GameShow Member Avatars + Contextual Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show member avatars (with a graceful initial-letter fallback) across every GameShow surface, and resolve member names with household context so parents display as "Mom"/"Dad".

**Architecture:** The backend already hydrates preset members to `{ id, name, avatar }` (`avatar = /api/v1/static/users/{id}`) and the frontend already threads `team.members[]` (with avatars) through TeamSetup → the game → the persisted session. So this is one backend name-rule line plus a new GameShow-local `MemberAvatar` component wired into five surfaces. No new data, no new endpoint.

**Tech Stack:** React 18, SCSS (dart-sass), Vitest 4 + happy-dom + @testing-library/react, Node/Express backend.

**Spec:** `docs/superpowers/specs/2026-07-15-gameshow-member-avatars-design.md`

## Global Constraints

- **Contextual name rule:** member `name` = `group_label || display_name || id`. Applies wherever member names render (all surfaces read `member.name`).
- **Avatar fallback:** when `member.avatar` is null OR the image errors, show the member's first initial (uppercased) on the team color, with text color from `onColor(teamColor)` (from `frontend/src/modules/GameShow/shell/teams/teamColors.js`).
- **`MemberAvatar` is GameShow-local** — do NOT import the Fitness `CircularUserAvatar` (coupled to HR/zones).
- **Token discipline:** no hex literals in SCSS outside `styles/_tokens.scss` and `shell/teams/teamColors.js`. New SCSS uses `--gs-*` tokens. (JSX may pass a hex `teamColor` default like `'#888'` — that is JS, not SCSS, and matches the existing `team.color || '#888'` pattern in `Scoreboard.jsx`.)
- **Frame contract:** TV-side SCSS uses no `vh`/`vw` (host `GameShowHost.scss` is exempt — real phone page).
- **Graceful degradation:** a surface renders text-only when a team has no `members` array or a member has no avatar image. Nothing breaks on missing data.
- **Test commands:**
  - Backend (colocated `*.test.mjs`), from repo root `/opt/Code/DaylightStation`: `npx vitest run <path>`
  - Frontend, from `/opt/Code/DaylightStation/frontend`: `npx vitest run <path>`; module suite `npx vitest run src/modules/GameShow`
  - Frontend build gate: `cd /opt/Code/DaylightStation/frontend && npx vite build`
- **Commit trailer** (every commit, verbatim last line): `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **This host is prod** (kckern-server). The final task deploys and MUST pass the `CLAUDE.local.md` deploy gates (no redeploy during an active fitness session or live video) before `sudo deploy-daylight`.

## File Structure

- **Modify** `backend/src/3_applications/gameshow/GameShowService.mjs` — `#hydrateMember` name rule.
- **Modify** `backend/src/3_applications/gameshow/GameShowService.test.mjs` — group_label assertions.
- **Create** `frontend/src/modules/GameShow/shell/components/MemberAvatar.jsx` (+ `.scss`, + `.test.jsx`) — the avatar primitive.
- **Modify** `frontend/src/modules/GameShow/shell/teams/TeamSetup.jsx` + `TeamSetup.scss` — chip avatars.
- **Modify** `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.jsx` + `Scoreboard.scss` — team member row.
- **Modify** `frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx`, `games/Jeopardy/Results.jsx`, `games/Jeopardy/Jeopardy.scss` — buzz-in + results avatars.
- **Modify** `frontend/src/modules/GameShow/host/GameShowHost.jsx` + `host/GameShowHost.scss` — host score avatars.

---

### Task 1: Contextual member names (backend, TDD)

**Files:**
- Modify: `backend/src/3_applications/gameshow/GameShowService.mjs:29-33`
- Test: `backend/src/3_applications/gameshow/GameShowService.test.mjs`

**Interfaces:**
- Produces: hydrated member `name` = `group_label || display_name || id` (id/avatar unchanged). Every frontend surface reads `member.name`.

- [ ] **Step 1: Read the current test to learn the mock's shape**

Run: `sed -n '1,60p' backend/src/3_applications/gameshow/GameShowService.test.mjs`
Note how `userService.getProfile` is mocked and how members are asserted (currently `{ id: 'felix', name: 'FELIX', avatar: '/api/v1/static/users/felix' }`). You will extend the mock so one profile carries a `group_label`.

- [ ] **Step 2: Write the failing test**

In `GameShowService.test.mjs`, update the mock `userService.getProfile` so it returns a `group_label` for one user (e.g. `kckern → { username: 'kckern', display_name: 'KC Kern', group_label: 'Dad' }`) and none for another (e.g. `felix → { username: 'felix', display_name: 'FELIX' }`). Then add assertions in the existing `getConfig hydrates preset members` test (or a new `it`):

```js
// contextual label wins when present
expect(cfg.team_presets[0].teams[1].members[0]).toMatchObject({ id: 'kckern', name: 'Dad' });
// falls back to display_name when no group_label
expect(cfg.team_presets[0].teams[0].members[0]).toMatchObject({ id: 'felix', name: 'FELIX' });
```

(Adjust team/member indices to match the test's preset fixture. If the fixture doesn't include kckern, add it to the fixture's preset teams and the mock.)

- [ ] **Step 3: Run it to verify it fails**

Run (from repo root): `npx vitest run backend/src/3_applications/gameshow/GameShowService.test.mjs`
Expected: FAIL — the `name: 'Dad'` assertion fails because `#hydrateMember` currently returns `display_name` ('KC Kern').

- [ ] **Step 4: Implement the name rule**

In `GameShowService.mjs`, change the `#hydrateMember` return (currently `name: profile.display_name || id`) to:

```js
    return {
      id,
      name: profile.group_label || profile.display_name || id,
      avatar: `/api/v1/static/users/${id}`,
    };
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run backend/src/3_applications/gameshow/GameShowService.test.mjs`
Expected: PASS (all assertions, including the unchanged avatar/defaults ones).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/gameshow/GameShowService.mjs backend/src/3_applications/gameshow/GameShowService.test.mjs
git commit -m "feat(gameshow): resolve member names with household context (group_label -> Mom/Dad)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `MemberAvatar` component (frontend, TDD)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/components/MemberAvatar.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/MemberAvatar.scss`
- Create: `frontend/src/modules/GameShow/shell/components/MemberAvatar.test.jsx`

**Interfaces:**
- Consumes: `onColor` from `../teams/teamColors.js` (returns paper/ink hex for contrast); `--gs-*` tokens from `styles/_tokens.scss`.
- Produces: `MemberAvatar({ member, teamColor, size, showName, className })` — default export. `member` is `{ id, name, avatar }`. Renders a circular `<img>` (from `member.avatar`) or an initial-letter fallback (on `teamColor`, text `onColor(teamColor)`) when `avatar` is null or the image errors. `showName` renders the name beside the disc.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/GameShow/shell/components/MemberAvatar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemberAvatar from './MemberAvatar.jsx';

describe('MemberAvatar', () => {
  it('renders the avatar image when member.avatar is set', () => {
    render(<MemberAvatar member={{ id: 'felix', name: 'Felix', avatar: '/api/v1/static/users/felix' }} teamColor="#3273dc" />);
    const img = screen.getByAltText('Felix');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/v1/static/users/felix');
  });

  it('renders an initial-letter fallback when avatar is null', () => {
    render(<MemberAvatar member={{ id: 'guest_1', name: 'Guest 1', avatar: null }} teamColor="#3273dc" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('G')).not.toBeNull();
  });

  it('falls back to the initial when the image errors', () => {
    render(<MemberAvatar member={{ id: 'x', name: 'Xander', avatar: '/bad.jpg' }} teamColor="#3273dc" />);
    fireEvent.error(screen.getByAltText('Xander'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('X')).not.toBeNull();
  });

  it('shows the name beside the disc when showName is set', () => {
    render(<MemberAvatar member={{ id: 'kckern', name: 'Dad', avatar: null }} teamColor="#3273dc" showName />);
    expect(screen.getByText('Dad')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `frontend/`): `npx vitest run src/modules/GameShow/shell/components/MemberAvatar.test.jsx`
Expected: FAIL — `Cannot find module './MemberAvatar.jsx'`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/modules/GameShow/shell/components/MemberAvatar.jsx`:

```jsx
import React, { useState } from 'react';
import { onColor } from '../teams/teamColors.js';
import './MemberAvatar.scss';

// A member's face across GameShow surfaces. Falls back to the member's first
// initial on the team color when there's no avatar image (guests, or a 404).
export function MemberAvatar({ member, teamColor = '#888', size = 40, showName = false, className = '' }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = member?.name || '';
  const initial = (name.trim()[0] || '?').toUpperCase();
  const useImg = member?.avatar && !imgFailed;
  const style = { '--ma-size': `${size}px`, '--team-color': teamColor, '--team-on': onColor(teamColor) };
  return (
    <span className={`gs-avatar ${className}`.trim()} style={style} title={name}>
      <span className="gs-avatar__disc">
        {useImg ? (
          <img className="gs-avatar__img" src={member.avatar} alt={name} onError={() => setImgFailed(true)} />
        ) : (
          <span className="gs-avatar__initial" aria-hidden="true">{initial}</span>
        )}
      </span>
      {showName && <span className="gs-avatar__name">{name}</span>}
    </span>
  );
}
export default MemberAvatar;
```

- [ ] **Step 4: Implement the styles**

Create `frontend/src/modules/GameShow/shell/components/MemberAvatar.scss`:

```scss
@use '../../styles/tokens' as gs;

.gs-avatar {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;

  &__disc {
    width: var(--ma-size, 40px);
    height: var(--ma-size, 40px);
    flex: 0 0 auto;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--team-color, var(--gs-tile-hi));
    box-shadow: 0 0 0 2px var(--gs-stage), 0 0 0 3px var(--team-color, var(--gs-tile-hi));
  }
  &__img { width: 100%; height: 100%; object-fit: cover; display: block; }
  &__initial {
    font-family: var(--gs-font-display);
    font-size: calc(var(--ma-size, 40px) * 0.5);
    line-height: 1;
    color: var(--team-on, var(--gs-paper));
  }
  &__name { font-family: var(--gs-font-ui); color: var(--gs-paper); }
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run src/modules/GameShow/shell/components/MemberAvatar.test.jsx`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/GameShow/shell/components/MemberAvatar.jsx frontend/src/modules/GameShow/shell/components/MemberAvatar.scss frontend/src/modules/GameShow/shell/components/MemberAvatar.test.jsx
git commit -m "feat(gameshow): MemberAvatar component with initial-letter fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: TeamSetup chip avatars

**Files:**
- Modify: `frontend/src/modules/GameShow/shell/teams/TeamSetup.jsx`
- Modify: `frontend/src/modules/GameShow/shell/teams/TeamSetup.scss`

**Interfaces:**
- Consumes: `MemberAvatar` (Task 2). `team.color` and each member object are already in scope in the render.

- [ ] **Step 1: Import MemberAvatar**

In `TeamSetup.jsx`, add after the existing reducer import:

```js
import MemberAvatar from '../components/MemberAvatar.jsx';
```

- [ ] **Step 2: Add an avatar to assigned-member chips**

Replace the assigned-member chip block:

```jsx
            {team.members.map((m) => (
              <button key={m.id} type="button" className="gs-chip gs-chip--member"
                onClick={() => dispatch({ type: 'REMOVE_MEMBER', teamId: team.id, memberId: m.id })}>
                {m.name} ×
              </button>
            ))}
```

with:

```jsx
            {team.members.map((m) => (
              <button key={m.id} type="button" className="gs-chip gs-chip--member"
                onClick={() => dispatch({ type: 'REMOVE_MEMBER', teamId: team.id, memberId: m.id })}>
                <MemberAvatar member={m} teamColor={team.color} size={26} />
                {m.name} ×
              </button>
            ))}
```

- [ ] **Step 3: Add an avatar to pool (add) chips**

Replace the pool chip block:

```jsx
            {pool.map((m) => (
              <button key={`add-${m.id}`} type="button" className="gs-chip gs-chip--pool"
                onClick={() => dispatch({ type: 'ASSIGN_MEMBER', teamId: team.id, member: m })}>
                + {m.name}
              </button>
            ))}
```

with:

```jsx
            {pool.map((m) => (
              <button key={`add-${m.id}`} type="button" className="gs-chip gs-chip--pool"
                onClick={() => dispatch({ type: 'ASSIGN_MEMBER', teamId: team.id, member: m })}>
                <MemberAvatar member={m} teamColor={team.color} size={22} />
                + {m.name}
              </button>
            ))}
```

- [ ] **Step 4: Make chips align the avatar with the text**

In `TeamSetup.scss`, in the `.gs-chip` rule (which currently starts `padding: 0.4rem 0.9rem; …`), add these three lines at the top of the block:

```scss
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
```

- [ ] **Step 5: Verify — module suite + build**

Run (from `frontend/`): `npx vitest run src/modules/GameShow && npx vite build`
Expected: all PASS (existing `teamSetupReducer.test.js` unaffected — no reducer change); build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/GameShow/shell/teams/TeamSetup.jsx frontend/src/modules/GameShow/shell/teams/TeamSetup.scss
git commit -m "feat(gameshow): avatars on TeamSetup member and pool chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Scoreboard member avatars

**Files:**
- Modify: `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.jsx`
- Modify: `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss`

**Interfaces:**
- Consumes: `MemberAvatar` (Task 2). `team.members` / `team.color` are on each team object.

- [ ] **Step 1: Import MemberAvatar**

In `Scoreboard.jsx`, add after `import './Scoreboard.scss';`:

```js
import MemberAvatar from '../components/MemberAvatar.jsx';
```

- [ ] **Step 2: Render a member-avatar row under the team name**

In the team card, between the `gs-scoreboard__name` span and the `gs-scoreboard__score` span, insert:

```jsx
          {team.members?.length > 0 && (
            <span className="gs-scoreboard__members">
              {team.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={team.color} size={22} />
              ))}
            </span>
          )}
```

So the card body reads: name span → (members row if any) → score span.

- [ ] **Step 3: Style the row**

In `Scoreboard.scss`, inside the `.gs-scoreboard` block (after the `&__team` rule), add:

```scss
  &__members {
    display: flex;
    gap: 0.25rem;
    justify-content: center;
    margin: 0.3rem 0 0.15rem;
  }
```

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npx vitest run src/modules/GameShow && npx vite build`
Expected: all PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.jsx frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss
git commit -m "feat(gameshow): member avatars on the scoreboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Buzz-in banner + Results avatars

**Files:**
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx`
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/Results.jsx`
- Modify: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss`

**Interfaces:**
- Consumes: `MemberAvatar` (Task 2). `lockedTeam` (ClueScreen) and each `t` (Results) are full team objects with `members`/`color`.

- [ ] **Step 1: Import MemberAvatar in ClueScreen**

In `ClueScreen.jsx`, add to the imports:

```js
import MemberAvatar from '../../shell/components/MemberAvatar.jsx';
```

- [ ] **Step 2: Add avatars to the buzz-in banner**

Replace the locked-team block:

```jsx
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color, '--team-on': onColor(lockedTeam.color) }}>
          {lockedTeam.name} buzzed in!
        </div>
      )}
```

with:

```jsx
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color, '--team-on': onColor(lockedTeam.color) }}>
          {lockedTeam.members?.length > 0 && (
            <span className="jp-clue__lockedavatars">
              {lockedTeam.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={lockedTeam.color} size={30} />
              ))}
            </span>
          )}
          {lockedTeam.name} buzzed in!
        </div>
      )}
```

- [ ] **Step 3: Import MemberAvatar in Results and add avatars per rank**

In `Results.jsx`, add after `import TitleCard from '../../shell/components/TitleCard.jsx';`:

```js
import MemberAvatar from '../../shell/components/MemberAvatar.jsx';
```

Replace the ranked list item:

```jsx
          <li key={t.id} style={{ '--team-color': t.color }}>
            {t.name}: {(scores[t.id] ?? 0).toLocaleString()}
          </li>
```

with:

```jsx
          <li key={t.id} style={{ '--team-color': t.color }}>
            {t.members?.length > 0 && (
              <span className="jp-results__avatars">
                {t.members.map((m) => (
                  <MemberAvatar key={m.id} member={m} teamColor={t.color} size={26} />
                ))}
              </span>
            )}
            {t.name}: {(scores[t.id] ?? 0).toLocaleString()}
          </li>
```

- [ ] **Step 4: Style both rows**

In `Jeopardy.scss`: in the `.jp-clue` block, after the `&__locked` rule, add:

```scss
  &__lockedavatars { display: inline-flex; gap: 0.3rem; margin-right: 0.6rem; vertical-align: middle; }
```

In the `.jp-results` block, inside the `&__list li` rule area, add a sibling rule:

```scss
  &__avatars { display: inline-flex; gap: 0.3rem; margin-right: 0.5rem; vertical-align: middle; }
```

- [ ] **Step 5: Verify**

Run (from `frontend/`): `npx vitest run src/modules/GameShow && npx vite build`
Expected: all PASS; build clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx frontend/src/modules/GameShow/games/Jeopardy/Results.jsx frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss
git commit -m "feat(gameshow): member avatars on buzz-in banner and results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Host companion score avatars

**Files:**
- Modify: `frontend/src/modules/GameShow/host/GameShowHost.jsx`
- Modify: `frontend/src/modules/GameShow/host/GameShowHost.scss`

**Interfaces:**
- Consumes: `MemberAvatar` (Task 2). `teams` here is `session.teams`, which the session store persists as-passed from the TV's `createSession({ teams: flow.teams })` — so `team.members[].avatar` is present.

- [ ] **Step 1: Import MemberAvatar**

In `GameShowHost.jsx`, add after `import { hostButtons } from './hostView.js';`:

```js
import MemberAvatar from '../shell/components/MemberAvatar.jsx';
```

- [ ] **Step 2: Add tiny avatars to each score chip**

Replace the header score span:

```jsx
        {teams.map((t) => (
          <span key={t.id} className="gsh__score" style={{ '--team-color': t.color || '#888' }}>
            <b>{t.name}</b> {(scores[t.id] ?? 0).toLocaleString()}
          </span>
        ))}
```

with:

```jsx
        {teams.map((t) => (
          <span key={t.id} className="gsh__score" style={{ '--team-color': t.color || '#888' }}>
            <b>{t.name}</b> {(scores[t.id] ?? 0).toLocaleString()}
            {t.members?.length > 0 && (
              <span className="gsh__scoreavatars">
                {t.members.map((m) => (
                  <MemberAvatar key={m.id} member={m} teamColor={t.color || '#888'} size={20} />
                ))}
              </span>
            )}
          </span>
        ))}
```

- [ ] **Step 3: Style the row**

In `GameShowHost.scss`, inside the `.gsh` block after the `&__score` rule, add:

```scss
  &__scoreavatars { display: flex; gap: 0.2rem; margin-top: 0.3rem; }
```

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npx vitest run src/modules/GameShow && npx vite build`
Expected: all PASS; build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/host/GameShowHost.jsx frontend/src/modules/GameShow/host/GameShowHost.scss
git commit -m "feat(gameshow): member avatars in the host companion score header

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full verification, deploy, on-TV check

**Files:** none — verification + deploy only.

- [ ] **Step 1: Full suites + build + token discipline**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/src/3_applications/gameshow/GameShowService.test.mjs
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/GameShow && npx vite build
grep -rn '#[0-9a-fA-F]\{3,6\}' src/modules/GameShow --include='*.scss' | grep -v styles/_tokens.scss
```

Expected: backend test PASS; module suite PASS; build clean; the grep prints **nothing** (new SCSS is token-only — MemberAvatar.scss and the added rules use `--gs-*` / `--team-*`, no hex).

- [ ] **Step 2: Deploy gates (prod — mandatory)**

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear to deploy = first prints `0`; second shows `sessionActive:false`, `rosterSize:0`, no `videoState:"playing"`. If either gate is active, WAIT.

- [ ] **Step 3: Build image + deploy**

```bash
cd /opt/Code/DaylightStation && sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Then wait for health and confirm the running container serves the new commit:

```bash
for i in $(seq 1 12); do st=$(sudo docker inspect --format '{{.State.Health.Status}}' daylight-station 2>/dev/null); echo "health: $st"; [ "$st" = "healthy" ] && break; sleep 5; done
sudo docker exec daylight-station sh -c 'cat /build.txt'
```

Expected: healthy; `/build.txt` Commit matches `git rev-parse --short HEAD`.

- [ ] **Step 4: Reload the living-room kiosk + screenshot**

Clear the FKB cache and reload, then screenshot the GameShow route to the scratchpad and view it:

```bash
sudo docker exec daylight-station sh -c "node -e \"
const yaml=require('js-yaml');const auth=yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const call=(cmd,extra={})=>{const qs=new URLSearchParams({cmd,password:auth.password,type:'json',...extra}).toString();return fetch('http://10.0.0.12:2323/?'+qs).then(r=>r.text());};
call('clearCache').then(()=>call('loadUrl',{url:'https://daylightlocal.kckern.net/app/gameshow'})).then(t=>console.log(t.slice(0,120)));
\""
sleep 9
sudo docker exec daylight-station sh -c "node -e \"
const yaml=require('js-yaml');const auth=yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs=new URLSearchParams({cmd:'getScreenshot',password:auth.password}).toString();
fetch('http://10.0.0.12:2323/?'+qs).then(r=>r.arrayBuffer()).then(b=>require('fs').writeFileSync('/tmp/gameshow-av.png',Buffer.from(b)));
\""
sudo docker exec daylight-station sh -c 'cat /tmp/gameshow-av.png' > "$SCRATCHPAD/gameshow-av.png"
```

View the PNG. Because the play surfaces (TeamSetup, board, results) need interactive navigation that the couch remote can't yet drive (a known separate blocker), the screenshot will most likely show the set-picker / resume-gate — confirming fonts + palette + no regression. **The avatar rendering itself is unit-verified** (MemberAvatar.test.jsx + the surface wirings). Note in the report that full on-screen avatar verification on the play surfaces is deferred to a hands-on session.

Then restore the normal screen:

```bash
sudo docker exec daylight-station sh -c "node -e \"
const yaml=require('js-yaml');const auth=yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs=new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.12:2323/?'+qs).then(r=>r.text()).then(t=>console.log(t.slice(0,120)));
\""
```

(`$SCRATCHPAD` = the session scratchpad directory. If the TV is in use, skip the loadUrl/screenshot and don't hijack the screen.)

- [ ] **Step 5: No app-wide regression**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/screen-framework 2>&1 | tail -5
```

Expected: screen-framework suite PASS.

---

## Self-Review (completed at plan-writing time)

- **Spec coverage:** D1 contextual name → Task 1; D4 MemberAvatar → Task 2; D3 fallback → Task 2 (initial-on-team-color via `onColor`); D2 surfaces → TeamSetup (Task 3), Scoreboard (Task 4), buzz-in + Results (Task 5), host (Task 6). D5 degradation → every surface guards on `members?.length` and MemberAvatar handles null/errored avatars. Testing + deploy → Task 7. Host feasibility (session carries members) verified — Task 6 is a real surface, not best-effort-only.
- **Type consistency:** `MemberAvatar` prop names (`member`, `teamColor`, `size`, `showName`, `className`) are identical across Tasks 2–6; import path is `../components/MemberAvatar.jsx` from `shell/*` and `../../shell/components/MemberAvatar.jsx` from `games/Jeopardy/*` and `../shell/components/MemberAvatar.jsx` from `host/*` (all resolved against actual directory depth). `onColor` import matches its Task-3 (prior work) definition in `shell/teams/teamColors.js`.
- **Placeholder scan:** every code step has complete, paste-ready content; no TBDs.
