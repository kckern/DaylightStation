# Creating a New Fitness App

## Quick Start
1. Create folder: `FitnessApps/apps/YourAppName/`
2. Create files: `manifest.js`, `index.jsx`, `YourAppName.jsx`, `YourAppName.scss`
3. Register in `FitnessApps/index.js`

## Manifest Required Fields
- `id`: Unique string matching config.yml
- `name`: Display name
- `version`: Semver string
- `modes`: Object with boolean flags for each mode (`standalone`, `overlay`, `sidebar`, `mini`)

## Using useFitnessApp Hook
```jsx
import useFitnessApp from '../../useFitnessApp';

const MyComponent = () => {
  const { 
    sessionId, 
    participants, 
    registerLifecycle 
  } = useFitnessApp('your_app_id');
  
  // ...
};
```

## Lifecycle Events
Register callbacks via `registerLifecycle({ onPause, onResume, onSessionEnd })`.

## Testing
1. Add app to config.yml `app_menus`
2. Navigate to Apps collection
3. Test all supported modes
