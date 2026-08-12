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
import { GetRecentCourseActivity } from './usecases/GetRecentCourseActivity.mjs';

export class PianoContainer {
  #studioDatastore;
  #fitnessPlayableService;
  #userVideoProgressStore;
  #composerSongStore;
  #configService;
  #plexClient;
  #learningService;
  #logger;

  #getCourseProgress;
  #getPlayableUnits;
  #getRecentCourseActivity;

  constructor({ studioDatastore, fitnessPlayableService = null, userVideoProgressStore = null, composerSongStore = null, configService, plexClient = null, learningService = null, logger = console } = {}) {
    if (!studioDatastore) throw new Error('PianoContainer: studioDatastore required');
    if (!configService) throw new Error('PianoContainer: configService required');
    this.#studioDatastore = studioDatastore;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#composerSongStore = composerSongStore;
    this.#configService = configService;
    this.#plexClient = plexClient;
    this.#learningService = learningService;
    this.#logger = logger;
  }

  /** The persistence adapter (straight-through CRUD lives here). */
  get studioDatastore() {
    return this.#studioDatastore;
  }

  /** Per-user Composer-mode composition persistence. */
  get composerSongStore() {
    return this.#composerSongStore;
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
        learningService: this.#learningService,
        logger: this.#logger,
      });
    }
    return this.#getPlayableUnits;
  }

  /** Activity endpoint 503s without the Plex-backed services. */
  isActivityConfigured() {
    return !!this.#fitnessPlayableService && !!this.#plexClient;
  }

  getRecentCourseActivity() {
    if (!this.#getRecentCourseActivity) {
      this.#getRecentCourseActivity = new GetRecentCourseActivity({
        fitnessPlayableService: this.#fitnessPlayableService,
        userVideoProgressStore: this.#userVideoProgressStore,
        configService: this.#configService,
        plexClient: this.#plexClient,
        logger: this.#logger,
      });
    }
    return this.#getRecentCourseActivity;
  }
}

export default PianoContainer;
