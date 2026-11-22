/**
 * School learner work — the public composition entry other apps read a
 * week of each learner's school work through (weekly review's TV cards).
 *
 * `createSchoolLearnerWork(...)` returns `{ list({from,to}), image(ref) }`
 * built over the lifecycle's own stores, or null when School is not wired
 * (or wiring throws, logged as `school.learner-work.wiring-failed`), so a
 * consumer treats "no School" and "School failed" the same way: no cards.
 *
 * Piano lessons and the sentence ladder are optional sources: pass
 * `learningEvidence` (School's evidence repository) with `lessonSittingLog`
 * for lesson names, and `getPlexClient()` for course names (a cached,
 * time-bounded lookup, see pianoCourseTitles.mjs; or pass your own
 * `pianoCourseTitleFor(courseId)`), and
 * `languageStudyStore` (or a `configService` to build a read-only use of the
 * YAML store) with `languageStudyService` for corpus labels. Study days use
 * the household timezone from `configService` and the 4am boundary.
 */
import { ListLearnerWork } from '../application/usecases/ListLearnerWork.mjs';
import { GetLearnerWorkImage } from '../application/usecases/GetLearnerWorkImage.mjs';
import { renderPdfFirstPagePng as defaultRenderPdfFirstPagePng } from '../rendering/documents/ArtifactPostviewRenderer.mjs';
import { FilesystemWorkImageCache } from '../adapters/persistence/FilesystemWorkImageCache.mjs';
import { YamlLanguageStudyDatastore } from '../adapters/persistence/YamlLanguageStudyDatastore.mjs';
import { studyDayForInstant } from '../domain/studyDay.mjs';
import { createPianoCourseTitleLookup } from './pianoCourseTitles.mjs';

const errorText = (err) => (err instanceof Error ? err.message : String(err));

export function createSchoolLearnerWork({
  schoolLifecycle, schoolLearnerDirectory, books = null, worksheetPlatforms = null,
  cardLadderStore = null, cardLadderTitleFor = null,
  learningEvidence = null, lessonSittingLog = null, pianoCourseTitleFor = null, getPlexClient = null,
  languageStudyStore = null, languageStudyService = null, configService = null,
  renderPdfFirstPagePng = defaultRenderPdfFirstPagePng, mediaBasePath, rootLogger,
} = {}) {
  const logger = rootLogger?.child?.({ module: 'school-learner-work' }) ?? rootLogger ?? {};
  if (!schoolLifecycle?.wired) {
    logger.info?.('school.learner-work.unwired', { reason: schoolLifecycle ? (schoolLifecycle.reason ?? 'school lifecycle not wired') : 'no school lifecycle' });
    return null;
  }
  try {
    if (typeof schoolLearnerDirectory?.listLearners !== 'function') throw new Error('schoolLearnerDirectory.listLearners is required');
    const stores = schoolLifecycle.stores ?? {};
    const learners = () => schoolLearnerDirectory.listLearners();
    // Weekly review only reads: the read-only view never migrates a
    // pre-rename package directory as a side effect of a TV page load.
    const cardLadder = cardLadderStore?.readOnlyView?.() ?? cardLadderStore ?? null;
    const platforms = worksheetPlatforms instanceof Map ? worksheetPlatforms : new Map();
    // Only the read methods (listCorpusIds, readCorpus, readEventDay) are used.
    const languageStudy = languageStudyStore
      ?? (typeof configService?.getUserDir === 'function' ? new YamlLanguageStudyDatastore({ configService }) : null);
    // The service caches parsed corpora; reading the corpus file for its label
    // would parse the whole (large) YAML on every weekly review load.
    const sentenceLadderTitleFor = typeof languageStudyService?.listCourses === 'function'
      ? (corpusId) => languageStudyService.listCourses().find((c) => c?.id === corpusId)?.label ?? null
      : null;
    // Built once at boot, so its title cache lives for the process.
    const courseTitleFor = pianoCourseTitleFor
      ?? (typeof getPlexClient === 'function' ? createPianoCourseTitleLookup({ getPlexClient, logger }) : null);
    const dayOf = (iso) => studyDayForInstant(Date.parse(iso), { timezone: configService?.getTimezone?.() || null });

    const listUseCase = new ListLearnerWork({
      learners,
      bookLog: stores.bookLog ?? null,
      bookRepository: stores.bookRepository ?? books?.bookRepository ?? null,
      coverUrlFor: books?.coverUrlFor ?? null,
      sessions: stores.sessions ?? null,
      curriculum: stores.curriculum ?? null,
      printedActivities: stores.printedActivities ?? null,
      cardLadder,
      cardLadderTitleFor,
      learningEvidence,
      lessonSittingLog,
      pianoCourseTitleFor: courseTitleFor,
      languageStudy,
      sentenceLadderTitleFor,
      dayOf,
      logger,
    });
    // No media mount: pages render on every request instead of once, and the
    // week's list is unaffected.
    const hasMediaBase = typeof mediaBasePath === 'string' && mediaBasePath.trim() !== '';
    if (!hasMediaBase) logger.warn?.('school.learner-work.no-image-cache', { reason: 'no mediaBasePath' });
    const cache = hasMediaBase ? new FilesystemWorkImageCache({ mediaBasePath }) : null;
    const imageUseCase = new GetLearnerWorkImage({
      learners,
      curriculum: stores.curriculum ?? null,
      printedActivities: stores.printedActivities ?? null,
      platforms,
      renderPdfFirstPagePng,
      cache,
      logger,
    });
    logger.info?.('school.learner-work.wired', {
      sources: ['bookLog', 'sessions', 'printedActivities'].filter((k) => stores[k])
        .concat(cardLadder ? ['cardLadder'] : [])
        .concat(learningEvidence ? ['pianoLessons'] : [])
        .concat(languageStudy ? ['sentenceLadder'] : []),
      platforms: [...platforms.keys()],
    });
    return {
      list: ({ from, to } = {}) => listUseCase.execute({ from, to }),
      image: (ref) => imageUseCase.execute(ref),
    };
  } catch (err) {
    logger.error?.('school.learner-work.wiring-failed', { error: errorText(err) });
    return null;
  }
}

export default createSchoolLearnerWork;
