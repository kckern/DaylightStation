/**
 * `/school/go/<learner>/card-ladder[/<package>]` (spec §8 Door). Resolves the
 * learner's CURRENT card-ladder enrollment so the URL follows weekly rollover.
 * It only mints the ordinary flashcards target; no authority is added.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export class CardLadderDoorLauncher {
  #assignments; #packageOf;
  constructor({ assignments, packageOf }) { this.#assignments = assignments; this.#packageOf = packageOf; }
  async issueLaunchTarget({ userId, programInstance = null }) {
    const programs = (await this.#assignments.get(userId))?.programs ?? [];
    const rows = programs.filter((row) => row?.programId === 'flashcards' && row.policy?.mode === 'card-ladder');
    const withPkg = await Promise.all(rows.map(async (row) => ({ row, pkg: await this.#packageOf(row.deckId ?? row.corpusId) })));
    let chosen = null;
    if (programInstance) chosen = withPkg.find((x) => x.pkg === programInstance) ?? null;
    else if (withPkg.length === 1) chosen = withPkg[0];
    else if (withPkg.length > 1) throw new ValidationError(`several word packages: ${withPkg.map((x) => x.pkg).sort().join(', ')} — add one to the URL`);
    if (!chosen) return null;
    const deckId = chosen.row.deckId ?? chosen.row.corpusId;
    return { kind: 'program', program: 'flashcards', deckId, policy: chosen.row.policy };
  }
}
export default CardLadderDoorLauncher;
