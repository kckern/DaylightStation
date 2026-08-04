import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/** Immutable artifact retrieval. This use case has no compiler dependency. */
export class GetSchoolCalcArtifact {
  #artifacts;

  constructor({ artifacts } = {}) {
    if (!artifacts) throw new Error('GetSchoolCalcArtifact requires artifacts');
    this.#artifacts = artifacts;
  }

  async execute({ artifactId } = {}) {
    const artifact = await this.#artifacts.getArtifact(artifactId);
    if (!artifact) throw new EntityNotFoundError('SchoolCalc artifact', artifactId);
    return artifact;
  }
}

export default GetSchoolCalcArtifact;

