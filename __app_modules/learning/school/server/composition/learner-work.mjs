/**
 * School learner work — the public composition entry other apps read a
 * week of each learner's school work through (weekly review's TV cards).
 *
 * `createSchoolLearnerWork(...)` returns `{ list({from,to}), image(ref) }`
 * built over the lifecycle's own stores, or null when School is not wired
 * (or wiring throws, logged as `school.learner-work.wiring-failed`), so a
 * consumer treats "no School" and "School failed" the same way: no cards.
 */
import { ListLearnerWork } from '../application/usecases/ListLearnerWork.mjs';
import { GetLearnerWorkImage } from '../application/usecases/GetLearnerWorkImage.mjs';
import { renderPdfFirstPagePng as defaultRenderPdfFirstPagePng } from '../rendering/documents/ArtifactPostviewRenderer.mjs';
import { FilesystemWorkImageCache } from '../adapters/persistence/FilesystemWorkImageCache.mjs';

const errorText = (err) => (err instanceof Error ? err.message : String(err));

export function createSchoolLearnerWork({
  schoolLifecycle, schoolLearnerDirectory, books = null, worksheetPlatforms = null,
  cardLadderStore = null, cardLadderTitleFor = null,
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
      logger,
    });
    const imageUseCase = new GetLearnerWorkImage({
      learners,
      curriculum: stores.curriculum ?? null,
      printedActivities: stores.printedActivities ?? null,
      platforms,
      renderPdfFirstPagePng,
      cache: new FilesystemWorkImageCache({ mediaBasePath }),
      logger,
    });
    logger.info?.('school.learner-work.wired', {
      sources: ['bookLog', 'sessions', 'printedActivities'].filter((k) => stores[k]).concat(cardLadder ? ['cardLadder'] : []),
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
