import SessionBrowserApp from './SessionBrowserApp';
import manifest from './manifest';

export default SessionBrowserApp;
// Widget registry pattern: default export + manifest, consumed via `import * as X`
// across 14+ widgets in Fitness/index.js - splitting out of scope for a lint pass.
// eslint-disable-next-line react-refresh/only-export-components
export { manifest };
