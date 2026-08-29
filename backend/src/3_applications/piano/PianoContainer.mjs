/**
 * PianoContainer — DI wiring for the piano kiosk bounded context.
 *
 * Constructed at the composition root (app.mjs) with production adapters:
 *   - studioDatastore        (YamlPianoStudioDatastore) — all persistence + paths
 *   - fitnessPlayableService — shared Plex-backed playable-episodes service
 *   - userVideoProgressStore — per-user video course progress
 *   - configProjection       — semantic piano settings and user projections
 *
 * Per Decision D1 it does NOT import concrete adapters; they arrive via config.
 * Use cases are lazily memoized (mirrors PlaybackHubContainer / NutribotContainer).
 * Legacy datastore accessors remain for test/composition compatibility. HTTP
 * adapters consume semantic PianoApiServices rather than these stores directly.
 */
import { GetCourseProgress } from './usecases/GetCourseProgress.mjs';
import { GetPlayableUnits } from './usecases/GetPlayableUnits.mjs';
import { GetRecentCourseActivity } from './usecases/GetRecentCourseActivity.mjs';

export class PianoContainer {
  #curriculumIndex;

  #studioDatastore;
  #fitnessPlayableService;
  #userVideoProgressStore;
  #composerSongStore;
  #configProjection;
  #plexClient;
  #learningService;
  #schoolAssignments;
  #logger;

  #getCourseProgress;
  #getPlayableUnits;
  #getRecentCourseActivity;

  constructor({ studioDatastore, fitnessPlayableService = null, userVideoProgressStore = null, composerSongStore = null, configProjection, plexClient = null, learningService = null, schoolAssignments = null, logger = console } = {}) {
    this.#curriculumIndex = arguments[0]?.curriculumIndex ?? null;
    if (!studioDatastore) throw new Error('PianoContainer: studioDatastore required');
    if (!configProjection) throw new Error('PianoContainer: configProjection required');
    this.#studioDatastore = studioDatastore;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#composerSongStore = composerSongStore;
    this.#configProjection = configProjection;
    this.#plexClient = plexClient;
    this.#learningService = learningService;
    // School's learner assignment store, read only to tell whether a
    // co-progress lockout is standing in front of today's assigned lesson.
    // Null in a composition without School — the lock then behaves as before.
    this.#schoolAssignments = schoolAssignments;
    this.#logger = logger;
  }

  /** Legacy composition/test accessor; API routers must use PianoStudioService. */
  get studioDatastore() {
    return this.#studioDatastore;
  }

  /** Legacy composition/test accessor; API routers use PianoCompositionService. */
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
        configProjection: this.#configProjection,
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
        configProjection: this.#configProjection,
        learningService: this.#learningService,
        curriculumIndex: this.#curriculumIndex,
        schoolAssignments: this.#schoolAssignments,
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
        configProjection: this.#configProjection,
        plexClient: this.#plexClient,
        logger: this.#logger,
      });
    }
    return this.#getRecentCourseActivity;
  }
}

export default PianoContainer;
