/**
 * @deprecated This file is deprecated and will be removed.
 * Use: import { userDataService } from '@backend/src/0_infrastructure/config/index.mjs';
 * Or:  import { userDataService } from '../../src/0_infrastructure/config/index.mjs';
 * 
 * This file now re-exports from the new location for backwards compatibility.
 */

// Re-export from new infrastructure location
export { userDataService } from '../../../src/0_infrastructure/config/UserDataService.mjs';
export { default } from '../../../src/0_infrastructure/config/UserDataService.mjs';
