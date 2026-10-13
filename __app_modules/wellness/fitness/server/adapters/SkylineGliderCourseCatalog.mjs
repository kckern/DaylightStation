import path from 'path';
import { fileURLToPath } from 'url';
import { listYamlFiles, loadYamlFromPath } from '#system/utils/FileIO.mjs';

const bundledPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'courses', 'mountain-pass.yml');
const TYPES = new Set(['open', 'lower-terrain', 'upper-terrain', 'corridor', 'collectible-path', 'checkpoint', 'finish']);

function validateCourse(course) {
  if (course?.schema !== 'skyline-glider-course/v1' || !/^[a-z][a-z0-9-]+$/.test(course?.id || '') || !Number.isInteger(course?.version) || !(course?.duration_s > 0)) return false;
  if (!Array.isArray(course.segments) || course.segments.filter((s) => s?.type === 'finish').length !== 1) return false;
  const ids = new Set();
  let prior = -1;
  for (const segment of course.segments) {
    if (!segment?.id || ids.has(segment.id) || !TYPES.has(segment.type) || !Number.isFinite(segment.start_s) || segment.start_s < prior) return false;
    if (segment.type === 'corridor' && (!(segment.ceiling >= 0) || !(segment.floor <= 1) || segment.floor - segment.ceiling < 0.1)) return false;
    ids.add(segment.id);
    prior = segment.start_s;
  }
  return true;
}

function readYaml(file) {
  return loadYamlFromPath(file);
}

export class SkylineGliderCourseCatalog {
  constructor({ configService, logger = console } = {}) {
    if (!configService) throw new Error('SkylineGliderCourseCatalog requires configService');
    this.configService = configService;
    this.logger = logger;
    this.bundled = readYaml(bundledPath);
    if (!validateCourse(this.bundled)) throw new Error('Bundled Skyline Glider course is invalid');
  }

  list(householdId) {
    const courses = new Map([[this.bundled.id, structuredClone(this.bundled)]]);
    const dir = this.configService.getHouseholdPath('fitness/skyline-glider/courses', householdId);
    for (const name of listYamlFiles(dir, { stripExtension: false }).sort()) {
      try {
        const course = readYaml(path.join(dir, name));
        if (!validateCourse(course)) throw new Error('course contract or reachability is invalid');
        courses.set(course.id, course);
      } catch (error) {
        this.logger.warn?.('fitness.skyline_glider.course_override.invalid', { file: name, error: error.message });
      }
    }
    return [...courses.values()];
  }
}
