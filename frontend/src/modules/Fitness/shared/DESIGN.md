# Fitness Apps Shared UX Component Framework

## Overview

This document outlines a comprehensive, extensible framework of shared UX components for Fitness Apps. These components are designed to be inherited and composed by apps like `JumpingJackGame`, `FitnessChartApp`, `CameraViewApp`, and future fitness applications.

The framework follows a layered architecture:
1. **Primitives** – Atomic UI building blocks (buttons, inputs, gauges)
2. **Composites** – Assembled combinations (panels, dialogs, navigation)
3. **Containers** – Layout scaffolding (full-screen, split-views, overlays)
4. **Integrations** – Domain-specific fitness components (avatars, charts, webcam)

---

## Directory Structure

```
frontend/src/modules/Fitness/FitnessApps/shared/
├── DESIGN.md                          # This specification
├── index.js                           # Barrel export for all components
├── primitives/
│   ├── index.js                       # Barrel export for primitives
│   ├── AppButton/
│   │   ├── AppButton.jsx
│   │   ├── AppButton.scss
│   │   └── index.js
│   ├── AppIconButton/
│   │   ├── AppIconButton.jsx
│   │   ├── AppIconButton.scss
│   │   └── index.js
│   ├── NumericKeypad/
│   │   ├── NumericKeypad.jsx
│   │   ├── NumericKeypad.scss
│   │   └── index.js
│   ├── Odometer/
│   │   ├── Odometer.jsx
│   │   ├── Odometer.scss
│   │   └── index.js
│   ├── Gauge/
│   │   ├── Gauge.jsx
│   │   ├── Gauge.scss
│   │   └── index.js
│   ├── ProgressBar/
│   │   ├── ProgressBar.jsx
│   │   ├── ProgressBar.scss
│   │   └── index.js
│   ├── ProgressRing/
│   │   ├── ProgressRing.jsx
│   │   ├── ProgressRing.scss
│   │   └── index.js
│   ├── TouchSlider/
│   │   ├── TouchSlider.jsx
│   │   ├── TouchSlider.scss
│   │   └── index.js
│   └── Timer/
│       ├── Timer.jsx
│       ├── Timer.scss
│       └── index.js
├── composites/
│   ├── index.js
│   ├── AppModal/
│   │   ├── AppModal.jsx
│   │   ├── AppModal.scss
│   │   └── index.js
│   ├── AppPanel/
│   │   ├── AppPanel.jsx
│   │   ├── AppPanel.scss
│   │   └── index.js
│   ├── AppList/
│   │   ├── AppList.jsx
│   │   ├── AppList.scss
│   │   └── index.js
│   ├── AppNavigation/
│   │   ├── AppNavigation.jsx
│   │   ├── AppNavigation.scss
│   │   └── index.js
│   ├── MultiChoice/
│   │   ├── MultiChoice.jsx
│   │   ├── MultiChoice.scss
│   │   └── index.js
│   ├── ConfirmDialog/
│   │   ├── ConfirmDialog.jsx
│   │   ├── ConfirmDialog.scss
│   │   └── index.js
│   ├── DataEntryForm/
│   │   ├── DataEntryForm.jsx
│   │   ├── DataEntryForm.scss
│   │   └── index.js
│   └── ActionBar/
│       ├── ActionBar.jsx
│       ├── ActionBar.scss
│       └── index.js
├── containers/
│   ├── index.js
│   ├── FullScreenContainer/
│   │   ├── FullScreenContainer.jsx
│   │   ├── FullScreenContainer.scss
│   │   └── index.js
│   ├── SplitViewContainer/
│   │   ├── SplitViewContainer.jsx
│   │   ├── SplitViewContainer.scss
│   │   └── index.js
│   ├── OverlayContainer/
│   │   ├── OverlayContainer.jsx
│   │   ├── OverlayContainer.scss
│   │   └── index.js
│   ├── GameCanvas/
│   │   ├── GameCanvas.jsx
│   │   ├── GameCanvas.scss
│   │   └── index.js
│   └── ResponsiveGrid/
│       ├── ResponsiveGrid.jsx
│       ├── ResponsiveGrid.scss
│       └── index.js
├── integrations/
│   ├── index.js
│   ├── UserAvatar/
│   │   ├── UserAvatar.jsx              # Re-exports CircularUserAvatar with enhancements
│   │   └── index.js
│   ├── UserAvatarGrid/
│   │   ├── UserAvatarGrid.jsx
│   │   ├── UserAvatarGrid.scss
│   │   └── index.js
│   ├── WebcamView/
│   │   ├── WebcamView.jsx              # Wrapper around FitnessWebcam
│   │   ├── WebcamView.scss
│   │   └── index.js
│   ├── TreasureBoxWidget/
│   │   ├── TreasureBoxWidget.jsx       # Wrapper around FitnessTreasureBox
│   │   └── index.js
│   ├── ChartWidget/
│   │   ├── ChartWidget.jsx             # Embeddable mini chart
│   │   ├── ChartWidget.scss
│   │   └── index.js
│   ├── MusicPlayerWidget/
│   │   ├── MusicPlayerWidget.jsx       # Compact music controls
│   │   └── index.js
│   ├── HeartRateDisplay/
│   │   ├── HeartRateDisplay.jsx
│   │   ├── HeartRateDisplay.scss
│   │   └── index.js
│   └── ZoneIndicator/
│       ├── ZoneIndicator.jsx
│       ├── ZoneIndicator.scss
│       └── index.js
├── hooks/
│   ├── index.js
│   ├── useGameLoop.js                  # requestAnimationFrame game loop
│   ├── useCountdown.js                 # Countdown timer with callbacks
│   ├── useAnimatedNumber.js            # Smooth number transitions
│   ├── useResponsiveSize.js            # Container size observer
│   ├── useTouchGestures.js             # Touch/swipe detection
│   ├── useKeyboardNav.js               # Arrow key navigation
│   └── useAudioFeedback.js             # Sound effect triggers
└── styles/
    ├── _variables.scss                 # CSS custom properties
    ├── _mixins.scss                    # Shared SCSS mixins
    ├── _animations.scss                # Reusable keyframe animations
    └── _base.scss                      # Common app styles
```

---

## Design Tokens & CSS Variables

All shared components use CSS custom properties for theming consistency:

```scss
// styles/_variables.scss
:root {
  // Colors - Base
  --app-bg-primary: #0f0f0f;
  --app-bg-secondary: #1a1a1a;
  --app-bg-tertiary: #252525;
  --app-bg-elevated: #2a2a2a;
  
  // Colors - Text
  --app-text-primary: #ffffff;
  --app-text-secondary: #aaaaaa;
  --app-text-muted: #666666;
  --app-text-accent: #4fc3f7;
  
  // Colors - Actions
  --app-action-primary: #4fc3f7;
  --app-action-primary-hover: #81d4fa;
  --app-action-success: #51cf66;
  --app-action-warning: #ffd43b;
  --app-action-danger: #ff6b6b;
  
  // Colors - Zones (Heart Rate)
  --zone-fire: #ff6b6b;
  --zone-hot: #ff922b;
  --zone-warm: #ffd43b;
  --zone-active: #51cf66;
  --zone-cool: #6ab8ff;
  --zone-rest: #888888;
  
  // Spacing
  --app-spacing-xs: 4px;
  --app-spacing-sm: 8px;
  --app-spacing-md: 16px;
  --app-spacing-lg: 24px;
  --app-spacing-xl: 32px;
  
  // Typography
  --app-font-family: system-ui, -apple-system, sans-serif;
  --app-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --app-font-size-xs: 10px;
  --app-font-size-sm: 12px;
  --app-font-size-md: 14px;
  --app-font-size-lg: 18px;
  --app-font-size-xl: 24px;
  --app-font-size-2xl: 32px;
  --app-font-size-3xl: 48px;
  
  // Borders & Radius
  --app-border-color: rgba(255, 255, 255, 0.1);
  --app-radius-sm: 4px;
  --app-radius-md: 8px;
  --app-radius-lg: 12px;
  --app-radius-xl: 16px;
  --app-radius-full: 9999px;
  
  // Shadows
  --app-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --app-shadow-md: 0 4px 8px rgba(0, 0, 0, 0.4);
  --app-shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.5);
  
  // Transitions
  --app-transition-fast: 150ms ease;
  --app-transition-normal: 250ms ease;
  --app-transition-slow: 400ms ease;
  
  // Z-Index Layers
  --app-z-base: 1;
  --app-z-overlay: 100;
  --app-z-modal: 200;
  --app-z-toast: 300;
}
```

---

## Component Specifications

### 1. Primitives

#### 1.1 AppButton

Versatile button component with variants for different contexts.

```jsx
// AppButton.jsx
const AppButton = ({
  variant = 'primary',      // 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size = 'md',              // 'sm' | 'md' | 'lg' | 'xl'
  icon,                     // Icon component or string
  iconPosition = 'left',    // 'left' | 'right'
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  onClick,
  className,
  ...props
}) => { /* ... */ };
```

**Usage:**
```jsx
<AppButton variant="primary" size="lg" onClick={handleStart}>
  START GAME
</AppButton>

<AppButton variant="ghost" icon={<IconBack />}>
  Back
</AppButton>
```

#### 1.2 AppIconButton

Circular/square icon-only buttons for toolbars and compact UIs.

```jsx
// AppIconButton.jsx
const AppIconButton = ({
  icon,                      // Required icon element
  variant = 'default',       // 'default' | 'primary' | 'danger' | 'success'
  size = 'md',               // 'sm' | 'md' | 'lg'
  shape = 'circle',          // 'circle' | 'square'
  badge,                     // Optional badge content (number/string)
  tooltip,                   // Optional tooltip text
  disabled = false,
  onClick,
  className,
  ariaLabel,                 // Required for accessibility
  ...props
}) => { /* ... */ };
```

**Usage:**
```jsx
<AppIconButton 
  icon={<CloseIcon />} 
  variant="danger" 
  ariaLabel="Close app"
  onClick={onClose} 
/>

<AppIconButton
  icon={<SettingsIcon />}
  badge="3"
  tooltip="Settings (3 new)"
  onClick={openSettings}
/>
```

#### 1.3 NumericKeypad

Touch-friendly numeric keypad for data entry (weights, reps, durations).

```jsx
// NumericKeypad.jsx
const NumericKeypad = ({
  value = '',                 // Current string value
  onChange,                   // (newValue: string) => void
  onSubmit,                   // () => void - Called on Enter/OK
  maxLength = 6,              // Max digits
  allowDecimal = true,
  allowNegative = false,
  placeholder = '0',
  label,                      // Optional label above display
  unit,                       // Optional unit suffix (e.g., 'lbs', 'reps')
  layout = 'standard',        // 'standard' | 'phone' | 'calculator'
  showBackspace = true,
  showClear = true,
  size = 'md',
  className,
  ...props
}) => { /* ... */ };
```

**Features:**
- Large touch targets (min 48x48px)
- Haptic feedback support (via vibration API)
- Clear/backspace controls
- Decimal point handling
- Input validation

**Usage:**
```jsx
const [weight, setWeight] = useState('');

<NumericKeypad
  value={weight}
  onChange={setWeight}
  onSubmit={() => logWeight(parseFloat(weight))}
  allowDecimal
  label="Enter Weight"
  unit="lbs"
/>
```

#### 1.4 Odometer

Animated number counter with rolling digit animation.

```jsx
// Odometer.jsx
const Odometer = ({
  value = 0,                  // Current numeric value
  format = 'integer',         // 'integer' | 'decimal' | 'currency' | 'time'
  decimals = 0,               // Decimal places (if format supports)
  duration = 500,             // Animation duration in ms
  easing = 'ease-out',
  prefix,                     // Optional prefix (e.g., '$')
  suffix,                     // Optional suffix (e.g., 'pts')
  padDigits = 0,              // Leading zeros
  size = 'md',                // 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  theme = 'default',          // 'default' | 'neon' | 'retro' | 'minimal'
  className,
  ...props
}) => { /* ... */ };
```

**Features:**
- Digit-by-digit rolling animation
- Multiple visual themes
- Configurable formats (time MM:SS, currency, etc.)
- Performance-optimized with RAF

**Usage:**
```jsx
<Odometer 
  value={score} 
  size="2xl" 
  theme="neon" 
  suffix=" pts"
/>

<Odometer 
  value={elapsed} 
  format="time" 
  size="lg"
/>
```

#### 1.5 Gauge

Circular or linear gauge for displaying progress, levels, or metrics.

```jsx
// Gauge.jsx
const Gauge = ({
  value = 0,                   // Current value
  min = 0,                     // Minimum value
  max = 100,                   // Maximum value
  type = 'circular',           // 'circular' | 'semi' | 'linear'
  size = 'md',                 // 'sm' | 'md' | 'lg' | 'xl'
  thickness = 8,               // Stroke width
  showValue = true,            // Display numeric value
  showTicks = false,           // Show tick marks
  tickCount = 5,
  label,                       // Label below gauge
  colorStops,                  // Array of { value, color } for gradient
  trackColor,                  // Background track color
  animated = true,
  duration = 400,
  className,
  ...props
}) => { /* ... */ };
```

**Usage:**
```jsx
<Gauge
  value={heartRate}
  min={60}
  max={200}
  type="semi"
  colorStops={[
    { value: 0, color: '#6ab8ff' },
    { value: 60, color: '#51cf66' },
    { value: 80, color: '#ffd43b' },
    { value: 100, color: '#ff6b6b' }
  ]}
  label="BPM"
/>
```

#### 1.6 ProgressBar

Horizontal/vertical progress indicator with optional segments.

```jsx
// ProgressBar.jsx
const ProgressBar = ({
  value = 0,                    // 0-100 or 0-1
  max = 100,
  variant = 'default',          // 'default' | 'striped' | 'segmented' | 'gradient'
  segments,                     // Array for segmented variant
  color,                        // Single color or 'zone' for HR-based
  size = 'md',                  // 'xs' | 'sm' | 'md' | 'lg'
  showLabel = false,
  labelFormat,                  // (value, max) => string
  animated = true,
  indeterminate = false,
  orientation = 'horizontal',   // 'horizontal' | 'vertical'
  className,
  ...props
}) => { /* ... */ };
```

#### 1.7 ProgressRing

Circular progress indicator (lighter than full Gauge).

```jsx
// ProgressRing.jsx
const ProgressRing = ({
  value = 0,
  max = 100,
  size = 48,
  strokeWidth = 4,
  color,
  trackColor = 'rgba(255,255,255,0.1)',
  animated = true,
  children,                     // Content inside ring
  className,
  ...props
}) => { /* ... */ };
```

#### 1.8 TouchSlider

Touch-optimized slider for volume, intensity, etc.

```jsx
// TouchSlider.jsx
const TouchSlider = ({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onChangeEnd,                  // Called when drag ends
  snapPoints,                   // Array of values to snap to
  marks,                        // Labeled marks array
  showValue = false,
  showTooltip = true,
  disabled = false,
  orientation = 'horizontal',
  size = 'md',
  className,
  ...props
}) => { /* ... */ };
```

#### 1.9 Timer

Countdown/count-up timer with controls.

```jsx
// Timer.jsx
const Timer = ({
  initialSeconds = 0,
  direction = 'down',           // 'up' | 'down'
  autoStart = false,
  onTick,                       // (seconds) => void
  onComplete,                   // () => void (for countdown)
  format = 'mm:ss',             // 'mm:ss' | 'h:mm:ss' | 'seconds'
  size = 'lg',
  showControls = false,
  warningThreshold,             // Seconds to trigger warning state
  children,                     // Render prop alternative
  className,
  ...props
}) => { /* ... */ };

// Imperative API via ref
ref.current.start()
ref.current.pause()
ref.current.reset()
ref.current.getTime()
```

---

### 2. Composites

#### 2.1 AppModal

Full-featured modal dialog system.

```jsx
// AppModal.jsx
const AppModal = ({
  isOpen = false,
  onClose,
  title,
  subtitle,
  size = 'md',                  // 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  backdrop = 'blur',            // 'blur' | 'dim' | 'none'
  position = 'center',          // 'center' | 'top' | 'bottom'
  animation = 'scale',          // 'scale' | 'slide-up' | 'slide-down' | 'fade'
  footer,                       // Footer content
  children,
  className,
  ...props
}) => { /* ... */ };

// Sub-components
AppModal.Header
AppModal.Body
AppModal.Footer
AppModal.Actions                // Pre-styled action button row
```

**Usage:**
```jsx
<AppModal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings">
  <AppModal.Body>
    {/* Settings content */}
  </AppModal.Body>
  <AppModal.Actions>
    <AppButton variant="ghost" onClick={() => setShowSettings(false)}>Cancel</AppButton>
    <AppButton variant="primary" onClick={saveSettings}>Save</AppButton>
  </AppModal.Actions>
</AppModal>
```

#### 2.2 AppPanel

Collapsible/draggable panel container.

```jsx
// AppPanel.jsx
const AppPanel = ({
  title,
  icon,
  collapsible = false,
  defaultCollapsed = false,
  draggable = false,
  resizable = false,
  position,                     // For draggable panels
  variant = 'default',          // 'default' | 'elevated' | 'outlined' | 'glass'
  padding = 'md',
  headerActions,                // Additional header buttons
  footer,
  children,
  className,
  ...props
}) => { /* ... */ };
```

#### 2.3 AppList

Virtualized scrollable list for selections.

```jsx
// AppList.jsx
const AppList = ({
  items,                        // Array of items
  renderItem,                   // (item, index, isSelected) => ReactNode
  keyExtractor,                 // (item) => string
  selectedKeys,                 // Set or array of selected keys
  onSelect,                     // (key, item) => void
  multiSelect = false,
  virtualized = true,           // Use virtual scrolling for large lists
  itemHeight = 48,              // For virtualization
  emptyMessage = 'No items',
  searchable = false,
  searchPlaceholder = 'Search...',
  dividers = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 2.4 AppNavigation

Navigation controls for multi-step flows.

```jsx
// AppNavigation.jsx
const AppNavigation = ({
  variant = 'arrows',           // 'arrows' | 'tabs' | 'breadcrumb' | 'stepper'
  items,                        // For tabs/breadcrumb/stepper
  activeIndex = 0,
  onChange,                     // (index) => void
  showBack = true,
  showForward = true,
  backLabel = 'Back',
  forwardLabel = 'Next',
  onBack,
  onForward,
  disableBack = false,
  disableForward = false,
  position = 'bottom',          // 'top' | 'bottom'
  className,
  ...props
}) => { /* ... */ };
```

**Usage:**
```jsx
// Simple back/forward navigation
<AppNavigation
  onBack={() => setStep(s => s - 1)}
  onForward={() => setStep(s => s + 1)}
  disableBack={step === 0}
  disableForward={step === steps.length - 1}
/>

// Stepper navigation
<AppNavigation
  variant="stepper"
  items={['Select', 'Configure', 'Confirm']}
  activeIndex={step}
  onChange={setStep}
/>
```

#### 2.5 MultiChoice

Selection UI for multiple choice questions/options.

```jsx
// MultiChoice.jsx
const MultiChoice = ({
  options,                      // Array of { value, label, icon?, disabled? }
  value,                        // Selected value(s)
  onChange,
  multiSelect = false,
  layout = 'vertical',          // 'vertical' | 'horizontal' | 'grid'
  columns = 2,                  // For grid layout
  size = 'md',
  variant = 'cards',            // 'cards' | 'buttons' | 'chips' | 'radio'
  showIcons = true,
  showCheckmarks = true,
  disabled = false,
  className,
  ...props
}) => { /* ... */ };
```

**Usage:**
```jsx
<MultiChoice
  options={[
    { value: 'easy', label: 'Easy', icon: '😊' },
    { value: 'medium', label: 'Medium', icon: '😐' },
    { value: 'hard', label: 'Hard', icon: '😤' }
  ]}
  value={difficulty}
  onChange={setDifficulty}
  layout="horizontal"
  variant="cards"
/>
```

#### 2.6 ConfirmDialog

Specialized modal for confirmations.

```jsx
// ConfirmDialog.jsx
const ConfirmDialog = ({
  isOpen = false,
  onConfirm,
  onCancel,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',          // 'default' | 'danger' | 'warning'
  icon,                         // Custom icon
  loading = false,              // Show loading state on confirm
  className,
  ...props
}) => { /* ... */ };
```

#### 2.7 DataEntryForm

Combined form for structured data input.

```jsx
// DataEntryForm.jsx
const DataEntryForm = ({
  fields,                       // Array of field definitions
  values,                       // Current form values object
  onChange,                     // (field, value) => void
  onSubmit,
  submitLabel = 'Submit',
  layout = 'vertical',          // 'vertical' | 'horizontal' | 'inline'
  showLabels = true,
  disabled = false,
  loading = false,
  className,
  ...props
}) => { /* ... */ };

// Field definition:
// {
//   name: 'weight',
//   type: 'numeric' | 'text' | 'select' | 'multiChoice',
//   label: 'Weight',
//   unit: 'lbs',
//   required: true,
//   validation: (value) => error | null
// }
```

#### 2.8 ActionBar

Fixed action bar (bottom of screen) for primary actions.

```jsx
// ActionBar.jsx
const ActionBar = ({
  position = 'bottom',          // 'top' | 'bottom'
  variant = 'solid',            // 'solid' | 'transparent' | 'blur'
  primaryAction,                // { label, onClick, icon?, loading?, disabled? }
  secondaryActions,             // Array of action definitions
  leftContent,                  // Custom left content
  rightContent,                 // Custom right content
  safeArea = true,              // Account for mobile safe areas
  className,
  ...props
}) => { /* ... */ };
```

---

### 3. Containers

#### 3.1 FullScreenContainer

Fullscreen app wrapper with safe areas.

```jsx
// FullScreenContainer.jsx
const FullScreenContainer = ({
  children,
  background = 'default',       // 'default' | 'dark' | 'gradient' | custom
  safeAreas = true,             // Respect device safe areas
  showHeader = false,
  headerContent,
  showFooter = false,
  footerContent,
  onExit,                       // Exit fullscreen callback
  exitOnEscape = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 3.2 SplitViewContainer

Flexible split-view layouts.

```jsx
// SplitViewContainer.jsx
const SplitViewContainer = ({
  layout = 'horizontal',        // 'horizontal' | 'vertical'
  ratio = [1, 1],               // Flex ratio for panes
  minSizes = [200, 200],        // Min pixel sizes
  resizable = false,
  collapsiblePane,              // 'primary' | 'secondary' | null
  defaultCollapsed = false,
  primaryContent,
  secondaryContent,
  gutter = 4,                   // Divider width
  className,
  ...props
}) => { /* ... */ };
```

#### 3.3 OverlayContainer

Floating overlay for game HUDs, notifications.

```jsx
// OverlayContainer.jsx
const OverlayContainer = ({
  position = 'center',          // 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  offset = { x: 0, y: 0 },
  width,
  height,
  backdrop = 'none',            // 'none' | 'dim' | 'blur'
  dismissible = true,
  onDismiss,
  animate = true,
  children,
  className,
  ...props
}) => { /* ... */ };
```

#### 3.4 GameCanvas

Canvas container for game rendering with animation loop.

```jsx
// GameCanvas.jsx
const GameCanvas = ({
  width,                        // Canvas width (or 'auto')
  height,                       // Canvas height (or 'auto')
  aspectRatio = '16:9',         // Used when auto-sizing
  onFrame,                      // (ctx, deltaTime, frameCount) => void
  onResize,                     // (width, height) => void
  fps = 60,                     // Target frame rate
  autoStart = true,
  pixelRatio = 'auto',          // 1, 2, or 'auto' for devicePixelRatio
  enableTouch = true,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  overlayContent,               // React content rendered above canvas
  className,
  ...props
}) => { /* ... */ };

// Imperative API
ref.current.start()
ref.current.stop()
ref.current.getContext()
ref.current.captureFrame()      // Returns data URL
```

**Usage:**
```jsx
const handleFrame = useCallback((ctx, dt) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Draw game elements
  gameState.entities.forEach(entity => entity.draw(ctx));
}, [gameState]);

<GameCanvas
  aspectRatio="4:3"
  onFrame={handleFrame}
  overlayContent={<ScoreDisplay score={score} />}
/>
```

#### 3.5 ResponsiveGrid

Adaptive grid layout for responsive apps.

```jsx
// ResponsiveGrid.jsx
const ResponsiveGrid = ({
  columns = 'auto',             // Number or 'auto'
  minChildWidth = 150,          // For auto columns
  gap = 'md',                   // 'sm' | 'md' | 'lg' or pixel value
  alignItems = 'stretch',
  justifyItems = 'stretch',
  children,
  className,
  ...props
}) => { /* ... */ };
```

---

### 4. Integrations

These components wrap existing fitness-specific components for easy app consumption.

#### 4.1 UserAvatar

Enhanced wrapper around `CircularUserAvatar`.

```jsx
// UserAvatar.jsx
import CircularUserAvatar from '../../../components/CircularUserAvatar.jsx';

const UserAvatar = ({
  user,                         // User object from participants
  size = 'md',                  // 'sm' | 'md' | 'lg' | 'xl'
  showHeartRate = true,
  showZone = true,
  showName = false,
  interactive = false,
  onClick,
  className,
  ...props
}) => { /* ... */ };
```

#### 4.2 UserAvatarGrid

Grid display of multiple user avatars.

```jsx
// UserAvatarGrid.jsx
const UserAvatarGrid = ({
  users,                        // Array of user objects
  maxVisible = 6,               // Max avatars to show
  size = 'md',
  layout = 'row',               // 'row' | 'grid' | 'stack'
  onUserClick,
  showOverflow = true,          // Show "+N more" indicator
  className,
  ...props
}) => { /* ... */ };
```

#### 4.3 WebcamView

Simplified webcam integration.

```jsx
// WebcamView.jsx
import { Webcam } from '../../../components/FitnessWebcam.jsx';

const WebcamView = ({
  enabled = true,
  mirror = true,
  aspectRatio = '4:3',
  showControls = false,
  captureInterval,              // Optional capture interval in ms
  onCapture,
  overlay,                      // Overlay content
  filter,                       // Filter preset
  className,
  ...props
}) => { /* ... */ };
```

#### 4.4 TreasureBoxWidget

Compact treasure box display.

```jsx
// TreasureBoxWidget.jsx
const TreasureBoxWidget = ({
  variant = 'compact',          // 'compact' | 'expanded' | 'mini'
  showTimer = true,
  showPerUser = false,
  animated = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 4.5 ChartWidget

Embeddable mini chart.

```jsx
// ChartWidget.jsx
const ChartWidget = ({
  type = 'line',                // 'line' | 'bar' | 'area'
  data,                         // Chart data array
  width,
  height,
  showAxes = false,
  showLegend = false,
  animated = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 4.6 MusicPlayerWidget

Compact music controls for apps.

```jsx
// MusicPlayerWidget.jsx
const MusicPlayerWidget = ({
  variant = 'mini',             // 'mini' | 'compact' | 'full'
  showArtwork = true,
  showVolume = false,
  showProgress = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 4.7 HeartRateDisplay

Heart rate number with zone coloring.

```jsx
// HeartRateDisplay.jsx
const HeartRateDisplay = ({
  heartRate,
  zone,                         // Zone object or zone ID
  size = 'md',                  // 'sm' | 'md' | 'lg' | 'xl'
  showIcon = true,
  showZoneLabel = false,
  animated = true,
  className,
  ...props
}) => { /* ... */ };
```

#### 4.8 ZoneIndicator

Visual zone indicator (bar/badge).

```jsx
// ZoneIndicator.jsx
const ZoneIndicator = ({
  zone,                         // Zone object or zone ID
  variant = 'bar',              // 'bar' | 'badge' | 'dot'
  showLabel = true,
  size = 'md',
  className,
  ...props
}) => { /* ... */ };
```

---

### 5. Hooks

#### 5.1 useGameLoop

```jsx
const { start, stop, isRunning, frameCount, fps } = useGameLoop({
  onFrame: (deltaTime, frameCount) => void,
  targetFps: 60,
  autoStart: true
});
```

#### 5.2 useCountdown

```jsx
const { time, isRunning, start, pause, reset, isComplete } = useCountdown({
  initialSeconds: 60,
  onTick: (remaining) => void,
  onComplete: () => void,
  autoStart: false
});
```

#### 5.3 useAnimatedNumber

```jsx
const displayValue = useAnimatedNumber(targetValue, {
  duration: 500,
  easing: 'easeOut',
  format: (n) => n.toFixed(0)
});
```

#### 5.4 useResponsiveSize

```jsx
const { width, height, ref } = useResponsiveSize({
  debounce: 100,
  onResize: ({ width, height }) => void
});
```

#### 5.5 useTouchGestures

```jsx
const { ref, gesture } = useTouchGestures({
  onTap: (point) => void,
  onDoubleTap: (point) => void,
  onSwipe: (direction, velocity) => void,
  onPinch: (scale) => void,
  onLongPress: (point) => void
});
```

#### 5.6 useKeyboardNav

```jsx
const { selectedIndex, handlers } = useKeyboardNav({
  itemCount: 10,
  wrap: true,
  onSelect: (index) => void,
  orientation: 'vertical' // 'vertical' | 'horizontal' | 'grid'
});
```

#### 5.7 useAudioFeedback

```jsx
const { play, preload, setVolume } = useAudioFeedback({
  sounds: {
    success: '/sounds/success.mp3',
    error: '/sounds/error.mp3',
    tick: '/sounds/tick.mp3'
  },
  enabled: true,
  volume: 0.5
});

// Usage
play('success');
```

---

## Usage Examples

### Example 1: Simple Exercise Counter App

```jsx
import React, { useState } from 'react';
import useFitnessApp from '../../useFitnessApp';
import {
  FullScreenContainer,
  Odometer,
  AppButton,
  AppNavigation,
  Timer,
  UserAvatarGrid,
  ActionBar
} from '../../shared';

const ExerciseCounterApp = ({ mode, onClose, onMount }) => {
  const { participants, registerLifecycle } = useFitnessApp('exercise_counter');
  const [count, setCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    onMount?.();
    registerLifecycle({
      onPause: () => setIsActive(false),
      onSessionEnd: () => setIsActive(false)
    });
  }, []);

  return (
    <FullScreenContainer>
      <UserAvatarGrid users={participants} size="sm" maxVisible={4} />
      
      <div className="counter-display">
        <Odometer value={count} size="3xl" theme="neon" />
        <span className="counter-label">REPS</span>
      </div>
      
      <Timer
        initialSeconds={60}
        direction="down"
        autoStart={isActive}
        onComplete={() => setIsActive(false)}
        size="lg"
      />
      
      <ActionBar
        primaryAction={{
          label: isActive ? 'STOP' : 'START',
          onClick: () => setIsActive(!isActive),
          variant: isActive ? 'danger' : 'primary'
        }}
        secondaryActions={[
          { label: 'Reset', onClick: () => setCount(0), disabled: isActive }
        ]}
      />
    </FullScreenContainer>
  );
};
```

### Example 2: Weight Entry App

```jsx
import React, { useState } from 'react';
import useFitnessApp from '../../useFitnessApp';
import {
  AppModal,
  NumericKeypad,
  Odometer,
  AppButton,
  MultiChoice,
  ConfirmDialog
} from '../../shared';

const WeightEntryApp = ({ mode, onClose, onMount }) => {
  const { logAppEvent, storage } = useFitnessApp('weight_entry');
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState(storage.get('unit', 'lbs'));
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    logAppEvent('weight_logged', { weight: parseFloat(weight), unit });
    setShowConfirm(false);
    setWeight('');
  };

  return (
    <AppModal isOpen={true} onClose={onClose} title="Log Weight" size="md">
      <AppModal.Body>
        <Odometer value={parseFloat(weight) || 0} size="xl" suffix={` ${unit}`} />
        
        <MultiChoice
          options={[
            { value: 'lbs', label: 'Pounds' },
            { value: 'kg', label: 'Kilograms' }
          ]}
          value={unit}
          onChange={(u) => { setUnit(u); storage.set('unit', u); }}
          layout="horizontal"
          variant="buttons"
        />
        
        <NumericKeypad
          value={weight}
          onChange={setWeight}
          onSubmit={handleSubmit}
          allowDecimal
          maxLength={5}
          placeholder="0.0"
        />
      </AppModal.Body>
      
      <AppModal.Actions>
        <AppButton variant="ghost" onClick={onClose}>Cancel</AppButton>
        <AppButton variant="primary" onClick={handleSubmit} disabled={!weight}>
          Log Weight
        </AppButton>
      </AppModal.Actions>
      
      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirm Weight"
        message={`Log ${weight} ${unit}?`}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </AppModal>
  );
};
```

### Example 3: Game with Canvas

```jsx
import React, { useState, useCallback, useRef } from 'react';
import useFitnessApp from '../../useFitnessApp';
import {
  FullScreenContainer,
  GameCanvas,
  Odometer,
  Timer,
  WebcamView,
  SplitViewContainer,
  ActionBar,
  useGameLoop
} from '../../shared';

const DodgeGameApp = ({ mode, onClose, onMount }) => {
  const { participants, getUserVitals } = useFitnessApp('dodge_game');
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState('ready');
  const gameDataRef = useRef({ player: { x: 200, y: 300 }, obstacles: [] });

  const handleFrame = useCallback((ctx, dt) => {
    const { width, height } = ctx.canvas;
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);
    
    // Update and draw game logic
    const game = gameDataRef.current;
    // ... game update logic
    
    // Draw player
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.arc(game.player.x, game.player.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  return (
    <FullScreenContainer>
      <SplitViewContainer
        layout="horizontal"
        ratio={[3, 1]}
        primaryContent={
          <GameCanvas
            aspectRatio="16:9"
            onFrame={handleFrame}
            autoStart={gameState === 'playing'}
            overlayContent={
              <div className="game-hud">
                <Odometer value={score} size="lg" suffix=" pts" />
                <Timer initialSeconds={60} direction="down" autoStart={gameState === 'playing'} />
              </div>
            }
          />
        }
        secondaryContent={
          <WebcamView enabled={true} mirror={true} />
        }
      />
      
      <ActionBar
        primaryAction={{
          label: gameState === 'ready' ? 'START' : 'RESTART',
          onClick: () => setGameState('playing')
        }}
      />
    </FullScreenContainer>
  );
};
```

---

## Implementation Priority

### Phase 1 (MVP)
1. `AppButton` / `AppIconButton`
2. `AppModal` / `ConfirmDialog`
3. `FullScreenContainer`
4. `Timer` / `Odometer`
5. `ProgressBar` / `ProgressRing`
6. Hooks: `useCountdown`, `useAnimatedNumber`, `useResponsiveSize`

### Phase 2 (Core Games)
1. `GameCanvas`
2. `NumericKeypad`
3. `MultiChoice`
4. `ActionBar` / `AppNavigation`
5. `WebcamView` / `UserAvatar` / `UserAvatarGrid`
6. Hooks: `useGameLoop`, `useTouchGestures`

### Phase 3 (Advanced)
1. `Gauge`
2. `TouchSlider`
3. `SplitViewContainer`
4. `AppList`
5. `DataEntryForm`
6. `ChartWidget` / `TreasureBoxWidget` / `MusicPlayerWidget`
7. Hooks: `useKeyboardNav`, `useAudioFeedback`

---

## Extension Guidelines

### Adding New Components

1. Create folder in appropriate layer (`primitives/`, `composites/`, etc.)
2. Include `index.js`, `ComponentName.jsx`, and optional `ComponentName.scss`
3. Export from layer's `index.js` barrel file
4. Document props with PropTypes and JSDoc
5. Add to main `shared/index.js` export
6. Follow CSS variable naming conventions
7. Ensure touch-friendly sizing (min 44x44px touch targets)
8. Support both controlled and uncontrolled modes where applicable

### Styling Guidelines

1. Use CSS custom properties from `_variables.scss`
2. Support `className` prop for customization
3. Use BEM-ish naming: `.app-button__icon--large`
4. Include responsive breakpoints where needed
5. Test on touch devices for appropriate sizing
6. Ensure color contrast meets WCAG AA standards

### Accessibility Requirements

1. Include `aria-label` on icon-only buttons
2. Support keyboard navigation
3. Use semantic HTML elements
4. Provide focus indicators
5. Support reduced motion preferences
6. Include role attributes where appropriate

---

## Related Files

- [FitnessAppContainer.jsx](FitnessAppContainer.jsx) – App wrapper
- [useFitnessApp.js](useFitnessApp.js) – App lifecycle hook
- [CircularUserAvatar.jsx](../components/CircularUserAvatar.jsx) – Base avatar component
- [FitnessWebcam.jsx](../components/FitnessWebcam.jsx) – Webcam component
- [FitnessTreasureBox.jsx](../FitnessSidebar/FitnessTreasureBox.jsx) – Treasure display
- [FitnessMusicPlayer.jsx](../FitnessSidebar/FitnessMusicPlayer.jsx) – Music player
- [TouchVolumeButtons.jsx](../FitnessSidebar/TouchVolumeButtons.jsx) – Touch volume example
