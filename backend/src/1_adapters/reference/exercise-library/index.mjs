// backend/src/1_adapters/reference/exercise-library/index.mjs
//
// The runtime face of the shared exercise-reference corpus: one manifest-backed
// repository serving both the Fitness browse/build/run module and the School anatomy
// shelf. The corpus itself is never walked at request time — see the repository's
// header for why, and `cli/exercise-library.cli.mjs` for the thing that does walk it.

export {
  YamlExerciseLibraryRepository,
  DEFAULT_MEDIA_BASE,
  SUPPORTED_SCHEMA_VERSION,
} from './YamlExerciseLibraryRepository.mjs';
