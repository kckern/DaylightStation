/**
 * Which bikes the live fitness flow tests drive.
 *
 * Equipment ids and cadence sensors are household config, so tests never name
 * them: they come from the installation's fitness config
 * (`household/fitness/config.yml` under the data path) — bikes that a cycle
 * selection targets first, then every other equipment entry with a cadence
 * sensor, in config order. `FITNESS_TEST_BIKES=id1,id2` overrides the order.
 *
 * Throws when nothing is configured: a live test that cannot find a bike fails.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getDataPath } from './configHelper.mjs';

function cycleSelectionEquipment(node, out = []) {
  if (Array.isArray(node)) node.forEach((item) => cycleSelectionEquipment(item, out));
  else if (node && typeof node === 'object') {
    if (node.type === 'cycle' && typeof node.equipment === 'string') out.push(node.equipment);
    Object.values(node).forEach((value) => cycleSelectionEquipment(value, out));
  }
  return out;
}

export function loadFitnessConfig() {
  const dataPath = getDataPath();
  if (!dataPath) throw new Error('fitnessTestBikes: no data path (set DAYLIGHT_DATA_PATH or DAYLIGHT_BASE_PATH)');
  const file = path.join(dataPath, 'household', 'fitness', 'config.yml');
  return yaml.load(fs.readFileSync(file, 'utf8')) || {};
}

/** @returns {{ id: string, cadence: string }[]} cadence bikes, most-relevant first */
export function getCycleTestBikes(config = loadFitnessConfig()) {
  const bikes = (config.equipment || []).filter((item) => item?.id && item.cadence != null);
  const byId = new Map(bikes.map((item) => [item.id, item]));
  const override = (process.env.FITNESS_TEST_BIKES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const order = override.length ? override : [...cycleSelectionEquipment(config), ...bikes.map((item) => item.id)];
  const ids = [...new Set(order)].filter((id) => byId.has(id));
  if (!ids.length) throw new Error('fitnessTestBikes: the fitness config has no equipment with a cadence sensor');
  return ids.map((id) => ({ id, cadence: String(byId.get(id).cadence) }));
}
