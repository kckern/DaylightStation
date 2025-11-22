# Player Module - Refactored Structure

This module has been refactored to improve maintainability by breaking down a monolithic 1175-line file into smaller, focused modules.

## Directory Structure

```
Player/
├── Player.jsx                      # Main player component (entry point)
├── Player.scss                     # Styles
├── Player.jsx.backup              # Original file backup
├── lib/                           # Utility functions
│   ├── helpers.js                 # Helper functions (guid, formatTime, etc.)
│   └── api.js                     # API functions (fetchMediaInfo, flattenQueueItems)
├── hooks/                         # Custom React hooks
│   ├── useCommonMediaController.js  # Media playback controller
│   └── useQueueController.js        # Queue/playlist management
└── components/                    # React components
  ├── ProgressBar.jsx            # Progress bar display
  ├── PlayerOverlayLoading.jsx   # Loading / resilience overlay
  ├── PlayerOverlayPaused.jsx    # Dedicated pause overlay
  ├── AudioPlayer.jsx            # Audio player component
  ├── VideoPlayer.jsx            # Video player component
  ├── SinglePlayer.jsx           # Single media player router
  └── CompositePlayer.jsx        # Composite player (video + audio overlay)
```

## Module Descriptions

### Main Component
- **Player.jsx**: Main player component that handles routing, queue management, and imperative handles

### Library Functions
- **lib/helpers.js**: Pure utility functions
  - `guid()`: Generate random IDs
  - `formatTime()`: Format seconds to MM:SS or HH:MM:SS
  - `getProgressPercent()`: Calculate playback progress percentage
  - `formatSeekTime()`: Format seek time
  - `mapReadyState()`: Map media ready state to text
  - `mapNetworkState()`: Map network state to text

- **lib/api.js**: API-related functions
  - `flattenQueueItems()`: Recursively flatten nested playlists/queues
  - `fetchMediaInfo()`: Fetch media information from API
  - `initializeQueue()`: Initialize queue from props

### Custom Hooks
- **hooks/useCommonMediaController.js**: Manages media playback state
  - Progress tracking
  - Stall detection and recovery
  - Media event handling
  - Volume and playback rate management
  - Keyboard control integration

- **hooks/useQueueController.js**: Manages playlist/queue state
  - Queue initialization
  - Queue advancement (forward/backward)
  - Shader cycling
  - Continuous playback mode

### Components
- **components/ProgressBar.jsx**: Simple progress bar with click-to-seek
- **components/PlayerOverlayLoading.jsx**: Loading / resilience overlay with debug details
- **components/PlayerOverlayPaused.jsx**: Pause overlay that displays playback status while paused
- **components/AudioPlayer.jsx**: Audio playback with album art and metadata
- **components/VideoPlayer.jsx**: Video playback with DASH support
- **components/SinglePlayer.jsx**: Routes to appropriate player based on media type
- **components/CompositePlayer.jsx**: Video player with audio overlay support

## Usage

The refactored Player works exactly as before:

```jsx
import Player from './modules/Player/Player.jsx';

// Single media playback
<Player play={{ plex: "12345" }} clear={clearFn} />

// Queue playback
<Player queue={{ playlist: "mylist" }} clear={clearFn} />

// Composite (video + audio overlay)
<Player play={{ plex: "video", overlay: "audioPlaylist" }} clear={clearFn} />
```

## Benefits of Refactoring

1. **Maintainability**: Each file has a single, clear responsibility
2. **Testability**: Smaller modules are easier to test in isolation
3. **Reusability**: Components and hooks can be reused across the application
4. **Readability**: Easier to understand and navigate the codebase
5. **Collaboration**: Multiple developers can work on different modules simultaneously
6. **Type Safety**: Clearer PropTypes definitions for each component

## Migration Notes

- Original file backed up as `Player.jsx.backup`
- All functionality preserved, no breaking changes
- Same props interface maintained
- All exports still available from main `Player.jsx`

## Exports

The main Player.jsx exports:
- `default`: The main Player component
- `PlayerOverlayLoading`: For external use
- `PlayerOverlayPaused`: For external use
- `SinglePlayer`: For external use
- `AudioPlayer`: For external use
- `VideoPlayer`: For external use
