import { AdminArtService } from '../application/admin/AdminArtService.mjs';
import { FilesystemArtAdminRepository } from '../adapters/admin/FilesystemArtAdminRepository.mjs';

export function createArtAdminService({ mediaBasePath, imgBasePath, configService, adminApiLogger }) {
  const adminArtService = new AdminArtService({
    repository: new FilesystemArtAdminRepository({
      mediaPath: mediaBasePath || imgBasePath,
      householdDir: configService.getHouseholdPath(''),
      logger: adminApiLogger,
    }),
    logger: adminApiLogger.child?.({ submodule: 'art' }) || adminApiLogger,
  });
  return adminArtService;
}
