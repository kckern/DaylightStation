/** Compile the deterministic bank selection into one immutable TI-family artifact. */
export class BuildAdaptiveStudyArtifact {
  #codec; #artifacts;

  constructor({ codec, artifacts } = {}) {
    if (!codec?.compile || !artifacts?.putArtifact) {
      throw new Error('BuildAdaptiveStudyArtifact requires codec and artifact repository');
    }
    this.#codec = codec;
    this.#artifacts = artifacts;
  }

  async execute({ unit, bank, curation } = {}) {
    const byId = new Map(bank.items.map((item) => [item.id, item]));
    const cards = curation.cardIds.map((id) => structuredClone(byId.get(id)));
    const quiz = curation.quizIds.map((id) => structuredClone(byId.get(id)));
    if (cards.some((item) => !item) || quiz.some((item) => !item)) {
      throw new Error('Adaptive Study curation no longer resolves against its bank revision');
    }
    const bundle = adaptiveBundle({ unit, bank, curation, cards, quiz });
    const compiled = await this.#codec.compile(bundle, undefined, { sourceBundle: bundle });
    const artifact = {
      ...compiled,
      interpretation: { schema: 'school.calc.artifact-interpretation/v1', bundle: structuredClone(bundle) },
    };
    return await this.#artifacts.putArtifact(artifact) ?? artifact;
  }
}

function adaptiveBundle({ unit, bank, curation, cards, quiz }) {
  return {
    schema: 'school.learning-lesson/v1',
    address: `adaptive/${unit.subject}/${unit.unitId}/${curation.bankRevision}/study`,
    context: {
      catalog: { catalogId: 'agenda', title: 'Agenda' },
      subject: { subjectId: unit.subject, title: unit.subject },
      course: { courseId: unit.courseId ?? unit.subject, title: unit.courseId ?? unit.subject },
      unit: { unitId: unit.unitId, title: unit.title },
    },
    lesson: {
      lessonId: `adaptive-${unit.unitId}`,
      title: unit.title,
      shortTitle: unit.title.slice(0, 20),
      objectives: [...(unit.objectives ?? [])],
      modules: [{
        moduleId: 'adaptive-study', type: 'flashcards', bankId: bank.id,
        bank: { id: bank.id, title: bank.title ?? unit.title, items: cards },
      }, {
        moduleId: 'adaptive-quiz', type: 'quiz', bankId: bank.id,
        passingPercent: curation.policy.passingPercent,
        bank: { id: bank.id, title: bank.title ?? unit.title, items: quiz },
      }],
    },
    capabilities: ['flashcards@1', 'quiz@1', 'response.choice@1'],
  };
}

export default BuildAdaptiveStudyArtifact;
