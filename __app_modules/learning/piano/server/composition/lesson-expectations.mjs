import { PianoLessonExpectationHarvester } from '../adapters/PianoLessonExpectationHarvester.mjs';
import { PlexLessonCaptionSource } from '../adapters/PlexLessonCaptionSource.mjs';
import { BuildLessonExpectations } from '../application/BuildLessonExpectations.mjs';

/**
 * Registers the nightly lesson-index job. Since 2026-11-12 it is index-only:
 * no decision gateway, so no rating calls (owner: "let's not trust our
 * ratings"); it only adds records for new lessons in engagement-gated courses.
 * Config (videos tabs) is re-read on every run so a config reload takes effect.
 */
export function registerPianoLessonExpectationHarvester({ harvesterServices, contentServices, contentRegistry, configService, rootLogger }) {
  const logger = rootLogger.child({ module: 'piano-lesson-expectations' });
  try {
    const store = contentServices?.lessonExpectations;
    if (!store) { logger.warn?.('piano.lesson-expectation.register-skipped', { reason: 'no-store' }); return; }
    const build = () => {
      const plex = contentRegistry?.get?.('plex');
      if (!plex?.client) throw new Error('plex source unavailable');
      const videos = configService.getHouseholdAppConfig?.(null, 'piano')?.videos || {};
      return new BuildLessonExpectations({
        lessonSource: new PlexLessonCaptionSource({ plexClient: plex.client, videosConfig: videos, logger }),
        store,
        decisionGateway: null,
        levelTargets: videos.practice?.level_targets,
        logger,
      });
    };
    harvesterServices.harvesterService.register(new PianoLessonExpectationHarvester({ buildLessonExpectations: build, logger }));
  } catch (err) {
    logger.warn?.('piano.lesson-expectation.register-failed', { error: err.message });
  }
}

export default registerPianoLessonExpectationHarvester;
