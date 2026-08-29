import path from 'node:path';
import { IRubiksCubeProgressRepository } from '#apps/school/rubiksCube/ports/IRubiksCubeProgressRepository.mjs';

export class FilesystemRubiksCubeProgressRepository extends IRubiksCubeProgressRepository {
  constructor({ configService, store, courseId }) {
    super();
    this.config = configService;
    this.store = store;
    this.courseId = courseId;
  }

  #file(userId) {
    if (!this.courseId) throw new Error('The Rubik’s Cube course is not installed.');
    if (!this.config.getUserProfile?.(userId)) return null;
    return path.join(this.config.getUserDir(userId), 'apps', 'school', 'rubiks-cube', this.courseId, 'progress.yml');
  }

  read(userId, fallback) {
    const file = this.#file(userId);
    if (!file) throw new Error('identified learner is required');
    return this.store.read(file, fallback);
  }

  write(userId, record) {
    const file = this.#file(userId);
    if (!file) throw new Error('identified learner is required');
    this.store.write(file, record);
    return record;
  }
}

export default FilesystemRubiksCubeProgressRepository;
