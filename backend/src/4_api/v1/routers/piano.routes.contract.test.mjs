import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

const routeInventory = [
  ['get', '/users'],
  ['get', '/users/:userId/attempts'], ['post', '/users/:userId/attempts'],
  ['get', '/users/:userId/game-budget'], ['post', '/users/:userId/game-budget/session'],
  ['post', '/users/:userId/game-budget/session/:sessionId/settle'], ['post', '/users/:userId/game-budget/session/:sessionId/close'],
  ['post', '/users/:userId/game-budget/credits'], ['post', '/users/:userId/challenges/prepare'],
  ['get', '/users/:userId/piano-challenge-profile'], ['put', '/users/:userId/piano-challenge-profile'],
  ['post', '/users/:userId/school-piano-challenges/:descriptorId/completion'],
  ['get', '/programs'], ['get', '/programs/:programId'], ['get', '/users/:userId/learning'],
  ['put', '/users/:userId/enrollments/:programId'], ['put', '/users/:userId/pending-checkpoints/:contentId'],
  ['delete', '/users/:userId/enrollments/:programId'], ['get', '/users/:userId/program-assignments'],
  ['put', '/users/:userId/program-assignments'], ['get', '/loop-manifest'],
  ['get', '/users/:userId/studio'], ['get', '/users/:userId/studio/:id'], ['post', '/users/:userId/studio'],
  ['patch', '/users/:userId/studio/:id'], ['delete', '/users/:userId/studio/:id'],
  ['get', '/users/:userId/compositions'], ['get', '/users/:userId/compositions/:id'],
  ['post', '/users/:userId/compositions'], ['put', '/users/:userId/compositions/:id'],
  ['delete', '/users/:userId/compositions/:id'], ['get', '/compositions/shared'],
  ...['loops', 'crate', 'songs'].flatMap((family) => [
    ['get', `/producer/${family}`], ['get', `/producer/${family}/:id`], ['post', `/producer/${family}`],
    ['patch', `/producer/${family}/:id`], ['delete', `/producer/${family}/:id`],
  ]),
  ['get', '/users/:userId/preferences'], ['put', '/users/:userId/preferences'],
  ['get', '/users/:userId/preset'], ['put', '/users/:userId/preset'],
  ['get', '/users/:userId/practice/:scoreKey'], ['put', '/users/:userId/practice/:scoreKey'],
  ['get', '/users/:userId/progress'], ['put', '/users/:userId/progress/:collection/:drillId'],
  ['get', '/bank'], ['get', '/bank/catalog'], ['get', '/bank/search'], ['get', '/bank/*splat'],
  ['get', '/lessons/:collection'], ['get', '/lessons/:collection/:id'],
  ['get', '/courses/progress'], ['get', '/courses/:courseId/playable'], ['get', '/activity/recent'],
  ['put', '/users/:userId/history/:date/:takeId'], ['post', '/effect-audit/:runId/clip/:label'],
  ['post', '/effect-audit/:runId/manifest'],
];

function subject() {
  const pianoStudioService = {
    isKnownUser: () => true, roster: () => [], loopManifest: () => [], listTakes: () => [], getTake: () => ({ id: 'take' }),
    getPreferences: () => ({}), getPreset: () => ({}), getPractice: () => ({}), getProgress: () => ({}),
    lessonIndex: () => ({}), lessonDrill: () => ({}),
  };
  const pianoCompositionService = {
    list: () => [], get: () => ({}), listShared: () => [], isKnownUser: () => true,
  };
  const pianoAttemptService = {
    listAuthorized: () => ({ kind: 'listed', attempts: [] }),
    submitAuthorized: () => ({ kind: 'saved', attempt: {} }),
    authorizeUser: () => ({ kind: 'authorized' }),
    acceptsPassedAssessment: () => true,
  };
  const seed = { id: 'chords/triads' };
  const pianoExerciseService = {
    available: true, index: () => ({}), catalog: () => ({}), search: () => [],
    getSeed: () => seed, seed: () => ({ ...seed, instances: 1 }), category: () => ({ seeds: [], categories: [] }),
    instances: () => ({ seed_id: seed.id, total: 0, instance_ids: [] }), instance: () => ({}),
  };
  const pianoCourseService = {
    coursesAvailable: true, activityAvailable: true, progress: async () => [],
    playable: async () => ({ ok: true, result: {} }), activity: async () => ({}),
  };
  const pianoProducerService = {
    list: () => ({ records: [], invalidRecords: [] }),
    listLight: () => ({ records: [], invalidRecords: [] }),
    get: () => ({ kind: 'found', data: {} }),
  };
  const router = createPianoRouter({
    pianoStudioService, pianoCompositionService, pianoAttemptService, pianoExerciseService, pianoCourseService,
    pianoCompletionNotifier: { schoolChallengeCompleted: vi.fn() }, pianoProducerService,
    producerIdPattern: /^[a-z0-9-]+$/,
    pianoGameBudgetService: { balance: async () => ({ enabled: true }) },
    pianoChallengeProfileService: { get: () => ({}) },
    pianoLearningService: {
      programs: () => [], program: () => ({}), summary: () => ({}), assignment: () => ({}),
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.roles = ['kiosk']; next(); });
  app.use('/piano', router);
  return { app, router };
}

describe('piano route contract', () => {
  it('preserves the exact method/path registration order', () => {
    const { router } = subject();
    const actual = router.stack.filter((layer) => layer.route).map((layer) => [
      Object.keys(layer.route.methods)[0], layer.route.path,
    ]);
    expect(actual).toEqual(routeInventory);
  });

  it('keeps every GET route reachable through HEAD with no response body', async () => {
    const { app } = subject();
    const paths = [
      '/users', '/users/u/attempts', '/users/u/game-budget', '/users/u/piano-challenge-profile',
      '/programs', '/programs/p1', '/users/u/learning', '/users/u/program-assignments', '/loop-manifest',
      '/users/u/studio', '/users/u/studio/take', '/users/u/compositions', '/users/u/compositions/song',
      '/compositions/shared', '/producer/loops', '/producer/loops/id', '/producer/crate', '/producer/crate/id',
      '/producer/songs', '/producer/songs/id', '/users/u/preferences', '/users/u/preset',
      '/users/u/practice/score-key', '/users/u/progress', '/bank', '/bank/catalog', '/bank/search',
      '/bank/chords', '/lessons/basics', '/lessons/basics/one', '/courses/progress',
      '/courses/course/playable?userId=u', '/activity/recent',
    ];
    for (const path of paths) {
      const response = await request(app).head(`/piano${path}`);
      expect(response.status, path).toBe(200);
      expect(response.text, path).toBeUndefined();
    }
  });
});
