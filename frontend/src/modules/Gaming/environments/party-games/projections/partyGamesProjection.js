import { createProjectionAdapter } from '../../../platform/projections/createProjectionAdapter.js';

export const partyGamesProjection = createProjectionAdapter({
  id: 'party-games.primary',
  project(authoritative) {
    return {
      phase: authoritative.state?.phase || authoritative.phase || 'unknown',
      scores: structuredClone(authoritative.state?.scores || authoritative.scores || {}),
      interaction: structuredClone(authoritative.interaction || {}),
      revision: authoritative.header?.revision ?? null,
    };
  },
});
