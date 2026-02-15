# Home Dashboard Redesign Plan

## 1. Overview
This design overhauls the `HomeApp` to move away from a scrolling document flow into a fixed "command center" layout. The goal is to provide immediate visibility into past performance, current health status, and future actions without requiring page interaction.

## 2. Layout Structure

### Container
- **Fixed Viewport:** The root container will occupy `100vh` (or 100% of available height) and `100vw`.
- **No Global Scroll:** `overflow: hidden` on the main container.
- **Grid Layout:** A 3-column grid layout (CSS Grid or Flexbox), splitting the screen into three equal 1/3 sections.

### Column A: Recent Activity (Left 1/3)
*Purpose: Context & History*
- **Component:** `WorkoutsCard`
- **Behavior:** This column is dedicated to the timeline of completed sessions.
- **Scrolling:** Internal vertical scrolling enabled (`overflow-y: auto`) for browsing history.
- **Visuals:** A timeline-like vertical list.

### Column B: Health Metrics (Center 1/3)
*Purpose: Status & Trends*
- **Components:** 
    1. `WeightTrendCard` (Top)
    2. `NutritionCard` (Bottom)
- **Arrangement:** Stacked vertically. 
- **Behavior:** 
    - Weight typically takes less space; Nutrition takes the remaining space.
    - If nutrition history is long, the nutrition card body can scroll internally, or the whole column can scroll if needed (though avoiding scroll here is cleaner).

### Column C: Action & Coaching (Right 1/3)
*Purpose: Engagement & Next Steps*
- **Components:**
    1. `UpNextCard` (Primary Call-to-Action)
    2. `CoachCard` (Interactive/Chat)
- **Arrangement:** Stacked vertically.
    - "Up Next" (Play) at the top for immediate access.
    - "Coach" below for reading updates or responding to prompts.
- **Behavior:** This is the interactive zone. Internal scrolling for the Coach section if the conversation/briefing is long.

## 3. Aesthetic & UI Changes

### Color Palette & Theming
- **Background:** Maintain the deep dark theme (`#1a1a2e` base), but distinguish columns slightly to create visual separation without heavy borders.
    - *Example:* Columns could have alternating subtle background shades or be separated by 1px distinct dividers.
- **Cards:** Move from "Paper" style cards (bg with shadow on bg) to a more integrated "Panel" look, or "Glassmorphism" tiles that fill the column width.
    - *Plan:* Remove massive margins between cards. Components should fill their grid cells.

### Typography & Hierarchy
- **Headers:** Uniform sticky headers for columns (e.g., "HISTORY", "METRICS", "COACH").
- **Data Density:** Increase data density slightly for the desktop/TV form factor.

## 4. Implementation Steps

### Step A: CSS/SCSS Structure
Rewrite `HomeApp.scss` to use CSS Grid:
```css
.home-app {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr; /* Three equal columns */
  height: 100vh;
  width: 100%;
  overflow: hidden;
  gap: var(--mantine-spacing-md);
  padding: var(--mantine-spacing-md);
  box-sizing: border-box;
}

.dashboard-column {
  display: flex;
  flex-direction: column;
  gap: var(--mantine-spacing-md);
  height: 100%;
  overflow: hidden; /* Prevent column itself from breaking layout */
  
  &.scrollable {
    overflow-y: auto; /* Internal scrolling */
  }
}
```

### Step B: Component Updates (`HomeApp.jsx`)
- Remove the responsive `<Grid>` (which collapses on mobile).
- Replace with a strict 3-column `<div>` structure matching the CSS Grid.
- Distribute widgets into the columns as defined above.
- Wrap specific sections (like the list inside WorkoutsCard) in scrollable containers.

### Step C: Widget Refinement (`DashboardWidgets.jsx`)
- **WorkoutsCard:** Ensure the list container takes `flex: 1` and handles overflow.
- **NutritionCard:** Maximize vertical space usage.
- **UpNextCard:** Emphasize the "Play" button as the primary hero element of the Right column.

## 5. Mockup Structure

```
+---------------------+---------------------+---------------------+
| COLUMN 1 (Scroll)   | COLUMN 2 (Fixed)    | COLUMN 3 (Fixed)    |
|                     |                     |                     |
| Header: SESSIONS    | Header: METRICS     | Header: UP NEXT     |
| [Session Item     ] | [Weight Graph     ] | [ Hero Play Card  ] |
| [Session Item     ] |                     |                     |
| [Session Item     ] | [Nutrition List   ] | Header: COACH       |
| [Session Item     ] | [Row              ] | [ Briefing Text   ] |
| [Session Item     ] | [Row              ] | [ CTA Button      ] |
| ...                 | [Row              ] | [ Prompt Options  ] |
|                     |                     |                     |
+---------------------+---------------------+---------------------+
```
