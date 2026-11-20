import { SheetMusicScoreReader } from '../adapters/SheetMusicScoreReader.mjs';
import { SheetMusicAdminService } from '../application/SheetMusicAdminService.mjs';
import { ProposeLearnSegments } from '../application/ProposeLearnSegments.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';
import { sheetMusicCollectionRefs } from '../../portable/music/musicXmlUpload.mjs';
import { extractMusicXmlFromMxl, MAX_MXL_XML_BYTES } from '../../../../../__capabilities/music-notation/server/mxlArchive.mjs';

/**
 * The admin sheet music service (library rows, Learn draft/approve/revert,
 * uploads, generated posters). The reader's media dir is `configService.getMediaDir()`: the same
 * value app.mjs passes as `mediaBasePath` to the files content adapter that
 * `/api/v1/proxy/media/stream/<local>` reads through, so the admin hashes and
 * writes the bytes the kiosk fetches.
 *
 * Jev segment proposals need `segmentDecisionGateway` (an IDecisionGateway) and
 * `sheetmusic.admin.boundaryScorer: jev` in the household piano config, read on
 * each request; without a configured gateway the proposer is absent.
 */
export function createSheetMusicAdminService({ configService, pianoStudioDatastore, rootLogger, segmentDecisionGateway = null }) {
  const mediaDir = configService.getMediaDir?.();
  if (!mediaDir) {
    rootLogger.warn?.('piano.sheetmusic-admin.disabled', { reason: 'no-media-dir' });
    return null;
  }
  const scoreReader = new SheetMusicScoreReader({ mediaDir });
  const LIBRARY_PREFIX = 'files:docs/sheet-music/';
  const logger = rootLogger.child({ module: 'piano-sheetmusic-admin' });
  const proposer = segmentDecisionGateway?.isConfigured?.()
    ? new ProposeLearnSegments({ gateway: segmentDecisionGateway, logger, scheduler: new NodeAsyncScheduler() })
    : null;
  return new SheetMusicAdminService({
    datastore: pianoStudioDatastore,
    scoreReader,
    // Not cached: the upload collision check needs the files on disk now.
    listScores: () => pianoStudioDatastore.listSheetMusicIds().map((id) => {
      const rest = id.slice(LIBRARY_PREFIX.length);
      const cut = rest.lastIndexOf('/');
      return { id, folder: cut >= 0 ? rest.slice(0, cut) : '', file: rest.slice(cut + 1) };
    }),
    listLearners: () => (pianoStudioDatastore.getRoster() || []).map((user) => String(user?.id ?? user)),
    fileSignature: (id) => scoreReader.signature(id),
    extractMxl: (buffer) => extractMusicXmlFromMxl(buffer, { maxXmlBytes: MAX_MXL_XML_BYTES }),
    writeScoreExclusive: (id, buffer) => scoreReader.writeScoreExclusive(id, buffer),
    writePoster: (id, svgText) => scoreReader.writePoster(id, svgText),
    // Re-read each call so a config reload changes the allowed folders.
    collectionRefs: () => sheetMusicCollectionRefs(configService.getHouseholdAppConfig?.(null, 'piano')?.sheetmusic),
    boundaryScorer: () => configService.getHouseholdAppConfig?.(null, 'piano')?.sheetmusic?.admin?.boundaryScorer,
    proposer,
    logger,
  });
}
