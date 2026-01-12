/**
 * Harvester Adapters
 *
 * Scheduled batch data harvesters for external APIs.
 *
 * @module harvester
 */

// Ports
export { IHarvester, HarvesterCategory } from './ports/IHarvester.mjs';

// Utilities
export { CircuitBreaker, CircuitState } from './CircuitBreaker.mjs';
export { YamlLifelogStore } from './YamlLifelogStore.mjs';
export { YamlAuthStore } from './YamlAuthStore.mjs';

// Fitness Harvesters
export { GarminHarvester } from './fitness/GarminHarvester.mjs';
export { StravaHarvester } from './fitness/StravaHarvester.mjs';
export { WithingsHarvester } from './fitness/WithingsHarvester.mjs';

// Productivity Harvesters
export { TodoistHarvester } from './productivity/TodoistHarvester.mjs';
export { ClickUpHarvester } from './productivity/ClickUpHarvester.mjs';
export { GitHubHarvester } from './productivity/GitHubHarvester.mjs';

// Social Harvesters
export { LastfmHarvester } from './social/LastfmHarvester.mjs';
export { RedditHarvester } from './social/RedditHarvester.mjs';
export { LetterboxdHarvester } from './social/LetterboxdHarvester.mjs';
export { GoodreadsHarvester } from './social/GoodreadsHarvester.mjs';

// Communication Harvesters
export { GmailHarvester } from './communication/GmailHarvester.mjs';
export { GCalHarvester } from './communication/GCalHarvester.mjs';

// Other Harvesters
export { WeatherHarvester } from './other/WeatherHarvester.mjs';
export { ScriptureHarvester } from './other/ScriptureHarvester.mjs';
// Note: YouTube (media download) and Budget (finance domain) don't fit IHarvester pattern
