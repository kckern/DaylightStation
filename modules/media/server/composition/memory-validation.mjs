import path from 'node:path';
import {MediaMemoryValidatorService} from '../application/MediaMemoryValidatorService.mjs';
import {YamlMediaMemoryValidationStore} from '../adapters/persistence/YamlMediaMemoryValidationStore.mjs';
import {PlexMemoryValidationGateway} from '../adapters/plex/PlexMemoryValidationGateway.mjs';
export function createMediaMemoryValidator({contentRegistry,mediaMemoryPath}) {
  const plexValidationAdapter = contentRegistry?.get('plex') || null;
  const mediaMemoryValidator = plexValidationAdapter?.client
    ? new MediaMemoryValidatorService({
      plexClient: new PlexMemoryValidationGateway({ client: plexValidationAdapter.client }),
      watchStateStore: new YamlMediaMemoryValidationStore({
        basePath: path.join(mediaMemoryPath, 'plex'),
      }),
      random: Math.random,
    })
    : null;
  return mediaMemoryValidator;
}
