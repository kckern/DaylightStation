/**
 * Every question the scene builder asks the decision model, in one place
 * (refineQuestions.mjs is the pattern). Each builder returns
 * { state, questions, read }. SCENE_QUESTION_VERSION is logged with every
 * answer so calibration ties to the wording that produced it.
 */

import { image, yesNo, score } from '#apps/common/ports/IDecisionGateway.mjs';

export const SCENE_QUESTION_VERSION = 1;

const GROUP_NAME = {
  violence_blood_gore: 'violence',
  sex_nudity_immodesty: 'nudity or immodesty',
  sex_any: 'sexual content',
};

/** What is happening, per group: 0 incidental .. 3 the worst of it. */
export const SITUATION_LEVELS = {
  violence_blood_gore: [
    'Incidental: no real violent situation (a passing mention, a toy gun, a cartoonish bump)',
    'Peril, threat or action: danger or fighting, but nobody is badly hurt',
    'People are hurt or killed: a real fight, shooting or attack',
    'Torture, or prolonged or cruel killing',
  ],
  sex_nudity_immodesty: [
    'Incidental: nothing really immodest happens',
    'Brief immodesty: revealing clothing or underwear, in passing',
    'Nudity or undress is part of the scene',
    'The scene is about nudity or sexual display',
  ],
  sex_any: [
    'Incidental: nothing sexual really happens',
    'Flirting, kissing, or suggestive talk',
    'A sexual situation is implied (heading to bed, groping, a proposition)',
    'Sexual content, or sexual assault or harassment',
  ],
};

/** How graphic a frame is, per group: 0 nothing .. 3 explicit. */
export const PICTURE_LEVELS = {
  violence_blood_gore: [
    'Nothing violent or bloody is visible',
    'Mild: action without visible injury, aftermath, a little blood, a body far away',
    'Clearly shows injury, blood, or a person being shot or struck',
    'Gore or mutilation',
  ],
  sex_nudity_immodesty: [
    'Everyone is normally clothed',
    'Partial undress: underwear, swimwear, revealing clothing',
    'Nudity is visible (breasts, buttocks)',
    'Explicit or full frontal nudity',
  ],
  sex_any: [
    'Nothing sexual is shown',
    'Kissing or embracing',
    'Sexual activity is implied on screen (in bed, groping, undressing someone)',
    'Sexual activity or sexual assault is shown',
  ],
};

/** Is tag B part of the same continuous scene as tag A? (text only) */
export function sameSceneQuestion({ title, a, b, gapSec, dialogue }) {
  return {
    state: { title: title || '', first: a, second: b, gap: `${Math.round(gapSec)} seconds`, dialogue: dialogue || '(no dialogue)' },
    questions: {
      same: yesNo('In the movie `title`, a content filter tagged `first`, and `gap` later tagged `second`. `dialogue` is what is said between them. Are both tags part of the same continuous scene (the same situation in the same place, without the story moving on to something else)?'),
    },
    read: (a2) => ({ p: a2.same.probability }),
  };
}

/** What is happening in this scene, per group present? (text only) */
export function situationQuestion({ title, tags, dialogue, groups }) {
  const questions = {};
  for (const g of groups) {
    questions[g] = score(`In the movie \`title\`, a scene carries the content tags in \`tags\`; \`dialogue\` is what is said during and just around it. Judge the ${GROUP_NAME[g]} in this scene: how serious is the situation, for a child watching?`, SITUATION_LEVELS[g]);
  }
  return {
    state: { title: title || '', tags: tags.join('\n'), dialogue: dialogue || '(no dialogue)' },
    questions,
    read: (a) => Object.fromEntries(groups.map((g) => [g, { level: Math.round(a[g].score), score: a[g].score, confidence: a[g].confidence }])),
  };
}

/** How graphic is this frame, per group present? */
export function pictureQuestion({ png, groups, hint }) {
  const questions = {};
  for (const g of groups) {
    questions[g] = score(`\`frame\` is one frame of a movie scene that contains ${GROUP_NAME[g]} (${hint}). How graphic is what this frame shows, for a child?`, PICTURE_LEVELS[g]);
  }
  return {
    state: { frame: image(png) },
    questions,
    read: (a) => Object.fromEntries(groups.map((g) => [g, a[g].score])),
  };
}
