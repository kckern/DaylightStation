import { createArtScreenPresetEnricher } from '../application/screenPresetEnricher.mjs';
import { FilesystemArtScreenPresetRepository } from '../adapters/FilesystemArtScreenPresetRepository.mjs';

export function createArtScreenPresets({ screensHouseholdDir, screensLogger }) {
  return createArtScreenPresetEnricher({
        repository: new FilesystemArtScreenPresetRepository({
          householdDir: screensHouseholdDir,
          logger: screensLogger,
        }),
        logger: screensLogger,
      });
}
