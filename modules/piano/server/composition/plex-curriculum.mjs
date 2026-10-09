/** Installed Plex enrichment: retain the owned CurriculumIndex module/cache. */
import {getCurriculumIndex,mergeEpisode,mergeSeason} from '../adapters/plex-curriculum/CurriculumIndex.mjs';
export const pianoCurriculumEnrichment=Object.freeze({getCurriculumIndex,mergeEpisode,mergeSeason});
