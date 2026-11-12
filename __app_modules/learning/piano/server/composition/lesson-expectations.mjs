import { PianoLessonExpectationHarvester } from '../adapters/PianoLessonExpectationHarvester.mjs';
import { PlexLessonCaptionSource } from '../adapters/PlexLessonCaptionSource.mjs';
import { BuildLessonExpectations } from '../application/BuildLessonExpectations.mjs';

/**
 * Registers the nightly lesson-expectation job. Config (videos tabs,
 * level_targets) is re-read on every run so a config reload takes effect.
 * `decisionGateway` arrives already scoped to
 * { app: 'piano', feature: 'lesson-expectation' }.
 */
export function registerPianoLessonExpectationHarvester({ harvesterServices, contentServices, contentRegistry, configService, decisionGateway, rootLogger }) {
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
        decisionGateway,
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
