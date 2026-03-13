# Fitness Chart Participant Focus Filter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-user focus filter to the FitnessChart that dims non-selected participants to 10% opacity, reorders z-index, and swaps avatar images for letter circles during focus mode.

**Architecture:** Single `focusedUserId` state in the `FitnessChart` component. The `RaceChartSvg` component receives it as a prop and applies per-element opacity and render ordering. No new files — all changes are in `FitnessChart.jsx` and `FitnessChart.scss`.

**Tech Stack:** React, SVG, SCSS

---

### Task 1: Add `focusedUserId` state and filter UI

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

**Step 1: Add state declaration**

After the `useLogScale` state (line 852), add:

```jsx
const [focusedUserId, setFocusedUserId] = useState(null);
```

**Step 2: Build the filter panel data**

After the `displayYTicks` line (line 1122), add a memo that derives filter entries from `allEntries`:

```jsx
const filterEntries = useMemo(() => {
    if (allEntries.length <= 1) return [];
    return allEntries.map(entry => ({
        id: entry.id,
        name: entry.name || entry.id,
        initial: (entry.name || entry.id || '?')[0].toUpperCase(),
        color: entry.color || '#9ca3af',
    }));
}, [allEntries]);
```

**Step 3: Render the filter panel in the JSX**

After the scale toggle button block (after line 1142), add the filter UI — only renders when `filterEntries.length > 0` and chart has data:

```jsx
{(hasData || persisted) && filterEntries.length > 0 && (
    <div className="race-chart__focus-filter">
        {filterEntries.map(entry => (
            <button
                key={entry.id}
                className={`race-chart__focus-filter-item${focusedUserId === entry.id ? ' race-chart__focus-filter-item--active' : ''}`}
                onClick={() => setFocusedUserId(prev => prev === entry.id ? null : entry.id)}
                title={`Focus on ${entry.name}`}
            >
                <svg width="20" height="20" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="9" fill="rgba(0,0,0,0.6)" stroke={entry.color} strokeWidth="2" />
                    <text x="10" y="10" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="11" fontWeight="600">
                        {entry.initial}
                    </text>
                </svg>
                <span>{entry.name}</span>
            </button>
        ))}
    </div>
)}
```

**Step 4: Commit**

```
feat(fitness): add focus filter UI to FitnessChart
```

---

### Task 2: Style the filter panel

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss`

**Step 1: Add filter panel styles**

Inside the `.fitness-chart` block, after the `.race-chart__scale-toggle` block (after the closing `}` around line 76), add:

```scss
.race-chart__focus-filter {
    position: absolute;
    top: 3.5rem;
    left: 2.5rem;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.race-chart__focus-filter-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 2px 6px 2px 0;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: 1;
    transition: color 0.15s;

    &:hover {
        color: rgba(255, 255, 255, 0.85);
    }

    &--active {
        color: rgba(255, 255, 255, 1);

        svg circle {
            stroke-width: 3;
        }
    }
}
```

**Step 2: Commit**

```
style(fitness): add focus filter panel styling
```

---

### Task 3: Pass `focusedUserId` to RaceChartSvg and apply path opacity + z-ordering

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

**Step 1: Add `focusedUserId` prop to RaceChartSvg**

Update the `RaceChartSvg` component signature (line 527) to accept `focusedUserId`:

```jsx
const RaceChartSvg = ({ paths, avatars, badges, connectors = [], xTicks, yTicks, width, height, focusedUserId }) => {
```

**Step 2: Apply opacity and z-ordering to paths**

Replace the paths rendering block (lines 556-576) with a version that sorts focused user's paths last and applies opacity:

```jsx
<g className="race-chart__paths">
    {(() => {
        const sorted = focusedUserId
            ? [...paths].sort((a, b) => (a.id === focusedUserId ? 1 : 0) - (b.id === focusedUserId ? 1 : 0))
            : paths;
        return sorted.map((path, idx) => {
            const isLongGap = path.isGap && (path.gapDurationMs || 0) >= MIN_GAP_DURATION_FOR_DASHED_MS;
            const isShortGap = path.isGap && !isLongGap;
            const isFocused = !focusedUserId || path.id === focusedUserId;
            const baseOpacity = isShortGap ? 0.7 : (path.opacity ?? 1);
            const finalOpacity = focusedUserId ? (isFocused ? baseOpacity : 0.1) : baseOpacity;
            return (
                <path
                    key={`${path.zone || 'seg'}-${idx}`}
                    d={path.d}
                    stroke={isLongGap ? ZONE_COLOR_MAP.default : path.color}
                    fill="none"
                    strokeWidth={PATH_STROKE_WIDTH}
                    opacity={finalOpacity}
                    strokeLinecap={isLongGap ? 'butt' : 'round'}
                    strokeLinejoin="round"
                    strokeDasharray={isLongGap ? '4 4' : undefined}
                />
            );
        });
    })()}
</g>
```

**Step 3: Pass `focusedUserId` in the JSX call site**

Update the `<RaceChartSvg>` call (around line 1146) to pass the prop:

```jsx
<RaceChartSvg
    paths={displayPaths}
    avatars={displayAvatars}
    badges={displayBadges}
    connectors={displayConnectors}
    xTicks={displayXTicks}
    yTicks={displayYTicks}
    width={chartWidth}
    height={chartHeight}
    focusedUserId={focusedUserId}
/>
```

**Step 4: Commit**

```
feat(fitness): apply focus opacity and z-ordering to chart paths
```

---

### Task 4: Apply focus mode to avatars — letter circles + opacity + z-ordering

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

**Step 1: Update avatar rendering in RaceChartSvg**

Replace the avatars rendering block (lines 615-680) with a version that:
- Sorts focused user's avatar group last (on top)
- Swaps `<image>` for letter `<text>` when focus mode is active
- Applies 10% opacity to non-focused avatars

```jsx
<g className="race-chart__avatars">
    {(() => {
        const sorted = focusedUserId
            ? [...avatars].sort((a, b) => (a.id === focusedUserId ? 1 : 0) - (b.id === focusedUserId ? 1 : 0))
            : avatars;
        return sorted.map((avatar, idx) => {
            const size = AVATAR_RADIUS * 2;
            const labelPos = avatar.labelPosition || 'right';
            let labelX = AVATAR_RADIUS + COIN_LABEL_GAP;
            let labelY = 0;
            let textAnchor = 'start';
            if (labelPos === 'left') {
                labelX = -(AVATAR_RADIUS + COIN_LABEL_GAP);
                textAnchor = 'end';
            } else if (labelPos === 'top') {
                labelX = 0;
                labelY = -(AVATAR_RADIUS + COIN_LABEL_GAP);
                textAnchor = 'middle';
            } else if (labelPos === 'bottom') {
                labelX = 0;
                labelY = AVATAR_RADIUS + COIN_LABEL_GAP + 12;
                textAnchor = 'middle';
            }
            const clipSafeId = slugifyId(avatar.id, 'user');
            const clipId = `race-clip-${clipSafeId}-${idx}`;
            const ax = avatar.x + (avatar.offsetX || 0);
            const ay = avatar.y + (avatar.offsetY || 0);
            const isFocused = !focusedUserId || avatar.id === focusedUserId;
            const groupOpacity = focusedUserId ? (isFocused ? 1 : 0.1) : 1;
            const initial = (avatar.name || avatar.id || '?')[0].toUpperCase();
            return (
                <g
                    key={clipId}
                    className="race-chart__avatar-group"
                    transform={`translate(${ax}, ${ay})`}
                    opacity={groupOpacity}
                >
                    <defs>
                        <clipPath id={clipId}>
                            <circle r={AVATAR_RADIUS} cx={0} cy={0} />
                        </clipPath>
                    </defs>
                    <text
                        x={labelX}
                        y={labelY}
                        className="race-chart__coin-label"
                        textAnchor={textAnchor}
                        dominantBaseline="middle"
                        fontSize={COIN_FONT_SIZE}
                        aria-hidden="true"
                    >
                        {formatCompactNumber(avatar.value)}
                    </text>
                    <circle className="race-chart__avatar-backdrop" r={AVATAR_RADIUS + 6} />
                    <circle
                        className="race-chart__avatar-zone"
                        r={AVATAR_RADIUS + 1.5}
                        stroke={avatar.color}
                    />
                    {focusedUserId ? (
                        <text
                            x={0}
                            y={0}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="white"
                            fontSize={AVATAR_RADIUS * 0.9}
                            fontWeight="700"
                            className="race-chart__avatar-initial"
                        >
                            {initial}
                        </text>
                    ) : (
                        <image
                            href={avatar.avatarUrl}
                            x={-AVATAR_RADIUS}
                            y={-AVATAR_RADIUS}
                            width={size}
                            height={size}
                            clipPath={`url(#${clipId})`}
                            preserveAspectRatio="xMidYMid slice"
                            className="race-chart__avatar-img"
                        />
                    )}
                </g>
            );
        });
    })()}
</g>
```

**Step 2: Commit**

```
feat(fitness): swap avatars for letter circles and apply opacity in focus mode
```

---

### Task 5: Apply focus mode to connectors and badges

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

**Step 1: Update connector rendering**

Replace the connectors block (lines 578-592) to apply focus opacity. Connectors carry an `id` property from ConnectorGenerator that matches the participant ID:

```jsx
<g className="race-chart__connectors">
    {connectors.map((conn) => {
        const isFocused = !focusedUserId || conn.id === focusedUserId;
        return (
            <line
                key={conn.id}
                x1={conn.x1}
                y1={conn.y1}
                x2={conn.x2}
                y2={conn.y2}
                stroke={conn.color || '#9ca3af'}
                strokeWidth={2}
                strokeDasharray="4 2"
                opacity={focusedUserId ? (isFocused ? 0.6 : 0.1) : 0.6}
            />
        );
    })}
</g>
```

**Step 2: Update badge rendering**

Replace the badges block (lines 593-613) to apply focus opacity. Badges have a `participantId` property:

```jsx
<g className="race-chart__absent-badges">
    {badges.map((badge) => {
        const bx = badge.x + (badge.offsetX || 0);
        const by = badge.y + (badge.offsetY || 0);
        const baseOpacity = badge.opacity ?? 1;
        const isFocused = !focusedUserId || badge.participantId === focusedUserId;
        const finalOpacity = focusedUserId ? (isFocused ? baseOpacity : 0.1) : baseOpacity;
        return (
            <g key={`absent-${badge.id}`} transform={`translate(${bx}, ${by})`} opacity={finalOpacity}>
                <circle r={ABSENT_BADGE_RADIUS} fill="#f3f4f6" stroke="#9ca3af" strokeWidth="1.5" />
                <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontSize={12}
                    fill="#4b5563"
                    fontWeight="600"
                >
                    {badge.initial}
                </text>
            </g>
        );
    })}
</g>
```

**Step 3: Commit**

```
feat(fitness): apply focus opacity to connectors and badges
```

---

### Task 6: Clear focus on session change

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`

**Step 1: Reset focusedUserId when session changes**

In the existing session-change effect (around line 857), add `setFocusedUserId(null)` alongside `setPersisted(null)`:

```jsx
useEffect(() => {
    if (lastPersistedSessionRef.current !== sessionId) {
        lastPersistedSessionRef.current = sessionId;
        setPersisted(null);
        setFocusedUserId(null);
    }
}, [sessionId]);
```

**Step 2: Also clear focus when participant count drops to 1**

After the `filterEntries` memo, add:

```jsx
useEffect(() => {
    if (allEntries.length <= 1) setFocusedUserId(null);
}, [allEntries.length]);
```

**Step 3: Commit**

```
fix(fitness): clear focus filter on session change or single participant
```

---

### Task 7: Verify connector ID field exists

**Files:**
- Read: `frontend/src/modules/Fitness/widgets/FitnessChart/layout/ConnectorGenerator.js`

**Step 1: Verify ConnectorGenerator includes participant ID**

Read `ConnectorGenerator.js` and confirm the generated connector objects include an `id` field matching the participant. If not, the connector's `id` may be a composite — check and adjust the focus opacity check in Task 5 accordingly. The connector `id` is set from `element.id` which is the participant ID, so this should work.

**Step 2: Manual verification**

Start the dev server and navigate to a fitness session with 2+ participants. Verify:
1. Filter panel appears below LIN/LOG toggle
2. Clicking a user dims others to 10% opacity
3. Focused user's path renders on top
4. Avatar images swap to letter circles in focus mode
5. Clicking the same user again exits focus mode
6. Connectors and badges dim correctly

**Step 3: Commit (if any fixes needed)**

```
fix(fitness): address focus filter issues found during verification
```
