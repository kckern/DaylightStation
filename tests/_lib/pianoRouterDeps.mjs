import { shortId } from '#system/utils/id.mjs';
import * as producerRecords from '#apps/piano/producerRecords.mjs';
import { createPianoApiServices } from '#apps/piano/PianoApiServices.mjs';
import { PianoContainer } from '#apps/piano/PianoContainer.mjs';
import { YamlPianoStudioDatastore } from '#adapters/piano/YamlPianoStudioDatastore.mjs';
import { PianoConfigProjection } from '#adapters/config/ApplicationConfigProjections.mjs';
import { EventBusPianoCompletionPublisher } from '#adapters/piano/EventBusPianoCompletionPublisher.mjs';

export function withPianoRouterServices(config = {}) {
  const {
    pianoContainer: suppliedContainer,
    pianoAttemptStore = null,
    exerciseBank = null,
    eventBus = null,
    configService = null,
    logger = console,
    ...rest
  } = config;
  const pianoContainer = suppliedContainer ?? new PianoContainer({
    studioDatastore: new YamlPianoStudioDatastore({ configService, logger }),
    configProjection: new PianoConfigProjection({ configService }),
  });
  return {
    ...rest,
    pianoContainer,
    idFactory: shortId,
    producerRecords,
    ...createPianoApiServices({
      studioDatastore: pianoContainer.studioDatastore,
      composerSongStore: pianoContainer.composerSongStore,
      pianoCourseContainer: pianoContainer,
      createId: shortId,
      producerRecords,
      pianoAttemptStore,
      exerciseBank,
      completionPublisher: eventBus ? new EventBusPianoCompletionPublisher({ eventBus }) : null,
      clock: { now: () => 1_754_930_000_000 },
      logger,
    }),
    producerIdPattern: producerRecords.PRODUCER_ID_RE,
    // createPianoRouter takes these directly and guards on them — a missing
    // attempt store makes every attempts route answer 501. They are
    // destructured out of `config` above, so they are NOT in `...rest` and have
    // to be handed back explicitly or the caller's store silently never
    // arrives. Placed AFTER the services spread so an explicit value wins.
    pianoAttemptStore,
    exerciseBank,
    eventBus,
    logger,
  };
}
