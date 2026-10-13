import { ArchiveConfigSource } from '../adapters/archive/ArchiveConfigSource.mjs';
import { DataServiceArchiveAccess } from '../adapters/archive/DataServiceArchiveAccess.mjs';

export async function configureLifelogArchive({ dataService, configService, rootLogger }) {
  const ArchiveServiceModule = await import('../application/archive/ArchiveService.mjs');
  const ArchiveService = ArchiveServiceModule.default;
  const archiveConfigSource = new ArchiveConfigSource({ configDirectory: configService.getConfigDir() });
  const archiveAccess = new DataServiceArchiveAccess({
    dataService,
    dataDir: configService.getDataDir(),
  });
  ArchiveServiceModule.configureArchiveService({
    loadArchiveConfig: archiveConfigSource.read,
    userLoadFile: archiveAccess.read.bind(archiveAccess),
    userSaveFile: archiveAccess.write.bind(archiveAccess),
    listArchiveYears: archiveAccess.listYears.bind(archiveAccess),
    logger: rootLogger.child({ module: 'archive' }),
  });
  return { ArchiveService, loadArchiveConfig: archiveConfigSource.read };
}
