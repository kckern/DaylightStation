/** Installed Plex enrichment: retain the owned CurriculumIndex module/cache. */
import {getCurriculumIndex,mergeEpisode,mergeSeason,configureCurriculumDir,curriculumDirFor} from '../adapters/plex-curriculum/CurriculumIndex.mjs';
export const pianoCurriculumEnrichment=Object.freeze({getCurriculumIndex,mergeEpisode,mergeSeason});
/** Point the curriculum reader at <dataDir>/content/piano/curriculum (household data volume). */
export const configurePianoCurriculum=(configService)=>configureCurriculumDir(curriculumDirFor(configService.getDataDir()));
