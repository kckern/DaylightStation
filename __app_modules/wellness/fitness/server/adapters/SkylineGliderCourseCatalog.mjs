import path from 'path';
import { fileURLToPath } from 'url';
import { listYamlFiles, loadYamlFromPath } from '#system/utils/FileIO.mjs';
import { resolveAct } from './skylineGlider/resolveAct.mjs';

// Bundled world: zones (art, sounds, entity classes) and acts (course layouts).
// Household files under fitness/skyline-glider/ add to or replace them by id.
const bundledRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skylineGlider');
const TYPES = new Set(['open', 'lower-terrain', 'upper-terrain', 'corridor', 'collectible-path', 'checkpoint', 'finish']);
const ID = /^[a-z][a-z0-9-]+$/;

function validateCourse(course) {
  if (course?.schema !== 'skyline-glider-course/v1' || !ID.test(course?.id || '') || !Number.isInteger(course?.version) || !(course?.duration_s > 0)) return false;
  if (!Array.isArray(course.segments) || course.segments.filter((s) => s?.type === 'finish').length !== 1) return false;
  if (course.act != null && !(Number.isInteger(course.act) && course.act > 0)) return false;
  const ids = new Set();
  let prior = -1;
  for (const segment of course.segments) {
    if (!segment?.id || ids.has(segment.id) || !TYPES.has(segment.type) || !Number.isFinite(segment.start_s) || segment.start_s < prior) return false;
    if (segment.type === 'corridor' && (!(segment.ceiling >= 0) || !(segment.floor <= 1) || segment.floor - segment.ceiling < 0.1)) return false;
    ids.add(segment.id);
    prior = segment.start_s;
  }
  for (const entity of course.entities || []) {
    if (!Number.isFinite(entity.at_s) || !(entity.altitude >= 0 && entity.altitude <= 1)) return false;
    if (!(entity.width_s > 0) || !(entity.height > 0)) return false;
  }
  return true;
}

const validZone = (zone) => zone?.schema === 'skyline-glider-zone/v1' && ID.test(zone?.id || '');

function readDir(dir) {
  return listYamlFiles(dir, { stripExtension: false }).sort().map((name) => ({ name, value: loadYamlFromPath(path.join(dir, name)) }));
}

export class SkylineGliderCourseCatalog {
  constructor({ configService, logger = console } = {}) {
    if (!configService) throw new Error('SkylineGliderCourseCatalog requires configService');
    this.configService = configService;
    this.logger = logger;
    this.bundledZones = new Map(readDir(path.join(bundledRoot, 'zones')).map(({ value }) => [value?.id, value]));
    this.bundledActs = readDir(path.join(bundledRoot, 'acts')).map(({ value }) => value);
    this.bundledWorld = loadYamlFromPath(path.join(bundledRoot, 'world.yml')) || { zones: [] };
    for (const zone of this.bundledZones.values()) if (!validZone(zone)) throw new Error(`Bundled Skyline Glider zone ${zone?.id} is invalid`);
    for (const act of this.bundledActs) {
      if (!validateCourse(resolveAct(act, this.bundledZones))) throw new Error(`Bundled Skyline Glider act ${act?.id} is invalid`);
    }
  }

  #householdPath(relative, householdId) {
    return this.configService.getHouseholdPath(`fitness/skyline-glider/${relative}`, householdId);
  }

  #zones(householdId) {
    const zones = new Map(this.bundledZones);
    for (const { name, value } of readDir(this.#householdPath('zones', householdId))) {
      if (validZone(value)) zones.set(value.id, value);
      else this.logger.warn?.('fitness.skyline_glider.zone_override.invalid', { file: name });
    }
    return zones;
  }

  #zoneOrder(householdId, zones) {
    const override = loadYamlFromPath(this.#householdPath('world.yml', householdId));
    const configured = Array.isArray(override?.zones) ? override.zones : this.bundledWorld.zones || [];
    const listed = configured.filter((id) => zones.has(id));
    return [...listed, ...[...zones.keys()].filter((id) => !listed.includes(id)).sort()];
  }

  /** Resolved acts in world order: zone order, then act number, then id. */
  list(householdId) {
    const zones = this.#zones(householdId);
    const acts = new Map();
    for (const act of this.bundledActs) acts.set(act.id, resolveAct(act, zones));
    for (const { name, value } of readDir(this.#householdPath('courses', householdId))) {
      try {
        if (value?.schema !== 'skyline-glider-course/v1') throw new Error('course contract is invalid');
        const resolved = resolveAct(value, zones);
        if (!validateCourse(resolved)) throw new Error('course contract or reachability is invalid');
        acts.set(resolved.id, resolved);
      } catch (error) {
        this.logger.warn?.('fitness.skyline_glider.course_override.invalid', { file: name, error: error.message });
      }
    }
    const order = this.#zoneOrder(householdId, zones);
    const rank = (act) => [order.indexOf(act.zone.id), act.act ?? Number.MAX_SAFE_INTEGER];
    return [...acts.values()].sort((a, b) => {
      const [za, aa] = rank(a);
      const [zb, ab] = rank(b);
      return za - zb || aa - ab || a.id.localeCompare(b.id);
    });
  }

  /** Zone rows in progression order, each listing its acts in play order. */
  world(householdId) {
    const zones = new Map();
    for (const act of this.list(householdId)) {
      if (!zones.has(act.zone.id)) zones.set(act.zone.id, { id: act.zone.id, name: act.zone.name, acts: [] });
      zones.get(act.zone.id).acts.push({ id: act.id, name: act.name, act: act.act });
    }
    return { zones: [...zones.values()] };
  }
}
