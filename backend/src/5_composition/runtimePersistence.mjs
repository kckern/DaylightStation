import { configService } from '#system/config/index.mjs';
import { DataService } from '#adapters/persistence/files/DataService.mjs';
import { ConfigUserDirectory } from '#adapters/identity/ConfigUserDirectory.mjs';

/** Process-wide persistence bindings owned by the composition layer. */
export const dataService = new DataService({ configService });
export const userService = new ConfigUserDirectory(configService);
