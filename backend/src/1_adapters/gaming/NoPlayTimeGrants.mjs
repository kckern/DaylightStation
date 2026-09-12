import { IPlayTimeGrant } from '#apps/gaming/ports/IPlayTimeGrant.mjs';

/**
 * The grant source used until the economy issues real ones.
 *
 * It answers "no grant" for every session, which is deliberately NOT the same as
 * an unlimited one: with no grant there is nothing to count down, so nothing
 * warns and nothing is ever stopped. Metering still runs and still records what
 * was played — the meter measures from the first day, and only starts costing
 * anything when a real grant source replaces this.
 *
 * Naming it, rather than leaving enforcement unwired, means "enforcement is off"
 * is a visible decision in the composition root instead of an absence someone
 * has to notice.
 */
export class NoPlayTimeGrants extends IPlayTimeGrant {
  async forSession() { return null; }
}

export default NoPlayTimeGrants;
