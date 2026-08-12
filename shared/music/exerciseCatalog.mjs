import { expandSeed } from './exerciseBank.mjs';

const dirname = (id) => id.split('/').slice(0, -1).join('/');

export function seedCatalogEntry(seed) {
  const instances = expandSeed(seed);
  const levels = instances.flatMap((instance) => Object.values(instance.level ?? {})).filter(Number.isFinite);
  const hands = [...new Set(instances.map((instance) => instance.shape?.hands).filter(Boolean))];
  return {
    id: seed.id,
    category: dirname(seed.id),
    title: seed.title,
    subtitle: seed.subtitle ?? null,
    focus: seed.focus ?? null,
    key: seed.key ?? null,
    meter: seed.meter ?? null,
    staff: seed.staff ?? null,
    tempo: seed.tempo ?? null,
    ordering: seed.ordering ?? 'strict',
    supports: seed.supports ?? ['free'],
    form: seed.derived?.form ?? instances[0]?.form ?? null,
    tradition: seed.provenance?.tradition ?? null,
    tags: seed.tags ?? [],
    hands,
    level_min: levels.length ? Math.min(...levels) : null,
    level_max: levels.length ? Math.max(...levels) : null,
    variants: instances.length,
    default_instance_id: instances[0]?.id ?? seed.id,
  };
}

export function buildExerciseCatalog(exerciseBank) {
  const categories = exerciseBank.listCategories().map((id) => {
    const category = exerciseBank.getCategory(id) ?? {};
    return {
      id, title: category.title ?? id.split('/').at(-1), subtitle: category.subtitle ?? null,
      ordered: Boolean(category.ordered), parent: id.includes('/') ? dirname(id) : null,
    };
  });
  const seeds = exerciseBank.allSeeds().map(seedCatalogEntry);
  return {
    title: exerciseBank.getIndex()?.title ?? 'Exercise Library',
    categories,
    seeds,
    totals: { seeds: seeds.length, variants: seeds.reduce((sum, seed) => sum + seed.variants, 0) },
  };
}

export default { buildExerciseCatalog, seedCatalogEntry };
