# CanvasReportRenderer Improvements

## Current State vs Target Design

### Reference Design (food_report.mjs)
![Reference](The target design from food_report.mjs includes:)

| Feature | Reference | Current Implementation |
|---------|-----------|----------------------|
| **Title** | `Thu, 6 Nov 2025 | Calories: 1559` | ✅ Implemented |
| **Pie Chart** | 3-slice macro pie with labels inside wedges | ❌ Missing |
| **Food List** | Sorted by calories, with macro color boxes on right | ⚠️ Basic text only |
| **Micro Stats** | Sodium, Fiber, Sugar, Cholesterol below pie | ❌ Missing |
| **7-Day Bar Chart** | Stacked macro bars with day labels | ❌ Missing |
| **Summary** | `-NaN lbs/week` or deficit summary | ❌ Missing |
| **Canvas Size** | 1080×1400 scaled 1.2x | ❌ Using 800×600 |

---

## Issues with Current Implementation

### 1. Missing Pie Chart
**Current:** Simple colored rectangles for macros  
**Target:** Circular pie chart with wedges sized by caloric contribution (protein×4, carbs×4, fat×9)

**Fix:** Implement `#makePieChart()` method:
```javascript
#makePieChart(pieChartData, size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  // Draw arcs for each macro wedge
  // Add labels inside each wedge
  return canvas;
}
```

### 2. Missing Proper Food List Layout
**Current:** Plain text list  
**Target:** 
- Calories in left column (right-aligned)
- Food name in center
- Macro boxes (colored rectangles) on right side

**Fix:** Implement `#makeFoodList()` with:
- Sort by calories descending
- Group duplicate items
- Draw colored macro boxes (fat=yellow, carbs=green, protein=pink)
- Use XOR composite operation for visual effect

### 3. Missing Micro Stats Section
**Current:** Not implemented  
**Target:** 4 rows below pie chart showing Sodium, Fiber, Sugar, Cholesterol

**Fix:** Add stats section after pie chart:
```javascript
const stats = [
  { label: 'Sodium', unit: 'mg', value: ... },
  { label: 'Fiber', unit: 'g', value: ... },
  { label: 'Sugar', unit: 'g', value: ... },
  { label: 'Cholesterol', unit: 'mg', value: ... },
];
```

### 4. Missing 7-Day Bar Chart
**Current:** Not implemented  
**Target:** Stacked bar chart showing last 7 days with:
- Each bar = total calories for day
- Stacked segments for protein (pink), carbs (green), fat (yellow)
- Day labels below (Fri, Sat, Sun, etc.)
- Calorie totals above each bar
- Horizontal grid lines for BMR and goal

**Fix:** Implement `#drawDailyChart()`:
```javascript
#drawDailyChart(ctx, history, items, ...) {
  // Build 7-day data array
  // Draw background
  // Draw grid lines for BMR/goal
  // Draw stacked bars for each day
  // Add day and calorie labels
}
```

### 5. Wrong Canvas Dimensions
**Current:** 800×600  
**Target:** 1080×1400 base, scaled 1.2x to 1296×1680

**Fix:**
```javascript
const width = 1080;
const height = 1400;
// ... draw everything ...
// Scale 1.2x at end
const scaled = createCanvas(width * 1.2, height * 1.2);
scaledCtx.drawImage(mainCanvas, 0, 0, width * 1.2, height * 1.2);
```

### 6. Missing Macro Color Boxes in Food List
**Current:** Just text  
**Target:** Each food row has small colored boxes showing protein/carbs/fat grams

**Fix:** In food list, draw macro boxes:
```javascript
const macroColors = { protein: '#fe938c', carbs: '#a3b18a', fat: '#f6bd60' };
['fat', 'carbs', 'protein'].forEach((macro, i) => {
  if (item[macro]) {
    drawRect(ctx, rightX - i * 40, y, 36, 37, macroColors[macro], `${item[macro]}g`);
  }
});
```

---

## Layout Specifications

```
┌──────────────────────────────────────────────────────────────┐
│                    TITLE (centered)                           │  60px from top
│              "Thu, 6 Nov 2025 | Calories: 1559"              │
├────────────────────┬─────────────────────────────────────────┤
│                    │                                          │
│    PIE CHART       │         FOOD LIST                        │
│    (40% width)     │         (60% width)                      │
│                    │  570  Tamales          [26g][20g][66g]   │
│   [Fat 89g]        │  220  Salad...         [18g][ 8g][10g]   │
│ [Carbs 117g]       │  160  Premier...       [ 3g][30g][ 5g]   │
│ [Protein 87g]      │  ...                                     │
│                    │                                          │
├────────────────────┤                                          │
│ Sodium    2185mg   │                                          │
│ Fiber       12g    │                                          │
│ Sugar       33g    │                                          │
│ Cholesterol 179mg  │                                          │
├────────────────────┴─────────────────────────────────────────┤
│                                                               │
│                    7-DAY BAR CHART                           │
│                                                               │
│  1694  1001  1554  1528  2706  1840  1559                    │
│  ████  ████  ████  ████  ████  ████  ████                    │
│  Fri   Sat   Sun   Mon   Tue   Wed   Thu                     │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│                    SUMMARY LINE                               │
│                   "-NaN lbs/week"                            │
└──────────────────────────────────────────────────────────────┘
```

---

## Color Palette (from food_report.mjs)

```javascript
const COLORS = {
  background: '#ffffff',
  text: '#000000',
  protein: '#fe938c',  // Pink/salmon
  carbs: '#a3b18a',    // Sage green  
  fat: '#f6bd60',      // Golden yellow
  chartBg: '#FAF3ED',  // Light cream
  barBase: '#CCC',     // Gray base for bars
  gridLine: '#AAA',    // Grid lines
};
```

---

## Priority Order for Implementation

1. **Canvas size** - Change to 1080×1400
2. **Pie chart** - Most visually prominent feature
3. **Food list with macro boxes** - Key data display
4. **7-day bar chart** - Historical context
5. **Micro stats** - Secondary info
6. **Summary line** - Nice to have
7. **1.2x scaling** - Final polish
