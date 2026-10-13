/** Persistence boundary for one learner's version-pinned Rubik's Cube progress. */
export class IRubiksCubeProgressRepository {
  read(_userId, _fallback) { throw new Error('read not implemented'); }
  write(_userId, _record) { throw new Error('write not implemented'); }
}

export default IRubiksCubeProgressRepository;
