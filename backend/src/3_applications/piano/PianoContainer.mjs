/**
 * PianoContainer — DI wiring for the piano kiosk bounded context.
 *
 * Constructed at the composition root (app.mjs) with production adapters:
 *   - studioDatastore        (YamlPianoStudioDatastore) — all persistence + paths
 *   - fitnessPlayableService — shared Plex-backed playable-episodes service
 *   - userVideoProgressStore — per-user video course progress
 *   - configService          — piano app config + user profiles (passed, not imported)
 *
 * Per Decision D1 it does NOT import concrete adapters; they arrive via config.
 * Use cases are lazily memoized (mirrors PlaybackHubContainer / NutribotContainer).
 * The datastore is exposed directly for the router's straight-through CRUD (studio,
 * producer, preferences, progress, lessons, history, effect-audit, loop-manifest,
 * roster); the two orchestrating algorithms live in use cases.
 */
import { GetCourseProgress } from './usecases/GetCourseProgress.mjs';
import { GetPlayableUnits } from './usecases/GetPlayableUnits.mjs';

export class PianoContainer {
  #studioDatastore;
  #fitnessPlayableService;
  #userVideoProgressStore;
  #configService;
  #logger;

  #getCourseProgress;
  #getPlayableUnits;

  constructor({ studioDatastore, fitnessPlayableService = null, userVideoProgressStore = null, configService, logger = console } = {}) {
    if (!studioDatastore) throw new Error('PianoContainer: studioDatastore required');
    if (!configService) throw new Error('PianoContainer: configService required');
    this.#studioDatastore = studioDatastore;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configService = configService;
    this.#logger = logger;
  }

  /** The persistence adapter (straight-through CRUD lives here). */
  get studioDatastore() {
    return this.#studioDatastore;
  }

  /** Course endpoints 503 when the Plex-backed playable service isn't wired. */
  isCourseServiceConfigured() {
    return !!this.#fitnessPlayableService;
  }

  getCourseProgress() {
    if (!this.#getCourseProgress) {
      this.#getCourseProgress = new GetCourseProgress({
        fitnessPlayableService: this.#fitnessPlayableService,
        userVideoProgressStore: this.#userVideoProgressStore,
        configService: this.#configService,
        logger: this.#logger,
      });
    }
    return this.#getCourseProgress;
  }

  getPlayableUnits() {
    if (!this.#getPlayableUnits) {
      this.#getPlayableUnits = new GetPlayableUnits({
        fitnessPlayableService: this.#fitnessPlayableService,
        userVideoProgressStore: this.#userVideoProgressStore,
        configService: this.#configService,
        logger: this.#logger,
      });
    }
    return this.#getPlayableUnits;
  }
}

export default PianoContainer;
